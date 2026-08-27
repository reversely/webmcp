import type { BomItem, Candidate, Decision, Placement, Product, Project } from "../types";
import type { DomainEvent, Emit } from "./events";

/** A project row plus the optimistic-concurrency version that `replaceBomItem` checks. */
export type ProjectRow = Project & { version: number };

export class NotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} ${id} not found`);
    this.name = "NotFoundError";
  }
}

export type StoreOptions = {
  emit?: Emit;
  newId?: (prefix: string) => string;
};

/**
 * In-memory rows for the BOM operations.
 *
 * Rows are treated as immutable: an operation replaces a row with `map.set(id, { ...row, ... })`
 * and never mutates one in place. That is what lets `mutate()` snapshot a table with a shallow
 * `new Map(table)` and restore it on failure.
 */
export class ProjectStore {
  readonly projects = new Map<string, ProjectRow>();
  readonly products = new Map<string, Product>();
  readonly candidates = new Map<string, Candidate>();
  readonly bomItems = new Map<string, BomItem>();
  readonly placements = new Map<string, Placement>();
  readonly decisions = new Map<string, Decision>();

  private readonly emitOut: Emit;
  private readonly makeId: (prefix: string) => string;
  private idCounter = 0;

  private depth = 0;
  private pendingEvents: DomainEvent[] = [];
  private changedProjects = new Set<string>();

  constructor(options: StoreOptions = {}) {
    this.emitOut = options.emit ?? (() => undefined);
    this.makeId = options.newId ?? ((prefix) => `${prefix}_${++this.idCounter}`);
  }

  newId(prefix: string): string {
    return this.makeId(prefix);
  }

  getProject(id: string): ProjectRow {
    return required(this.projects, "Project", id);
  }

  getProduct(id: string): Product {
    return required(this.products, "Product", id);
  }

  getBomItem(id: string): BomItem {
    return required(this.bomItems, "BomItem", id);
  }

  insertProject(project: Project): ProjectRow {
    const row = { ...project, version: 0 };
    this.projects.set(row.id, row);
    return row;
  }

  /** Emits inside a `mutate()` block are held until the outermost block commits. */
  emit(event: DomainEvent): void {
    if (this.depth === 0) this.emitOut(event);
    else this.pendingEvents.push(event);
  }

  /**
   * Run `fn` atomically against this store.
   *
   * On the outermost call the tables are snapshotted first; a throw restores them, drops buffered
   * events, and rethrows. On commit, every project passed to `markChanged` gets its version
   * bumped once, then buffered events flush in order. Nested calls join the enclosing block.
   */
  mutate<T>(fn: () => T): T {
    const snapshot = this.depth === 0 ? this.snapshot() : null;
    this.depth += 1;
    try {
      return fn();
    } catch (error) {
      if (snapshot) this.restore(snapshot);
      throw error;
    } finally {
      this.depth -= 1;
      if (this.depth === 0) this.commit();
    }
  }

  /** Record that a row of this project changed, so the commit bumps its version. */
  markChanged(projectId: string): void {
    this.changedProjects.add(projectId);
  }

  private commit(): void {
    for (const id of this.changedProjects) {
      const project = this.projects.get(id);
      if (project) this.projects.set(id, { ...project, version: project.version + 1 });
    }
    const events = this.pendingEvents;
    this.changedProjects = new Set();
    this.pendingEvents = [];
    for (const event of events) this.emitOut(event);
  }

  private snapshot() {
    return {
      projects: new Map(this.projects),
      products: new Map(this.products),
      candidates: new Map(this.candidates),
      bomItems: new Map(this.bomItems),
      placements: new Map(this.placements),
      decisions: new Map(this.decisions)
    };
  }

  private restore(snapshot: ReturnType<ProjectStore["snapshot"]>): void {
    for (const table of Object.keys(snapshot) as (keyof typeof snapshot)[]) {
      const live = this[table] as Map<string, unknown>;
      live.clear();
      for (const [id, row] of snapshot[table]) live.set(id, row);
    }
    this.pendingEvents = [];
    this.changedProjects = new Set();
  }
}

function required<T>(table: Map<string, T>, entity: string, id: string): T {
  const row = table.get(id);
  if (!row) throw new NotFoundError(entity, id);
  return row;
}
