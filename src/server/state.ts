/**
 * Server-side application state for the prototype: one in-memory ProjectStore plus the tables the
 * BOM store does not own (spaces, requirements, board documents, chat messages). Kept on
 * `globalThis` so Next.js dev-server module reloads do not wipe it. Postgres replaces this (#15).
 */
import { catalogClient, GLOBAL_CATALOG_ENDPOINT, type CatalogCallHook, type CatalogClient } from "../commerce";
import { createInMemoryStore, type AgentRunStore } from "../domain/agent-run";
import { calculateBudget, regenerateBom, ProjectStore, type Budget, type DomainEvent } from "../domain/bom";
import { startModelGeneration } from "../domain/ingestion/hooks";
import { normalizeCatalogProduct } from "../domain/products/normalize";
import { checkLayout, type LayoutCheck } from "../domain/geometry";
import { recordIssue, withSpan } from "./trace";
import type { Candidate, Category, DeliveryAddress, Member, Placement, Product, Project, Requirement, Space } from "../domain/types";

export type ArtifactKind = "sourcing" | "ranking" | "question" | "spec" | "room_estimate";

/** A board artifact carried by a chat message; the UI updates it in place by `id` (PRD 9.2, 13.1). */
export type Artifact = { kind: ArtifactKind; id: string; data: unknown };

export type ChatMessage = {
  id: string;
  role: "user" | "agent";
  author: string;
  text: string;
  at: string;
  artifact?: Artifact;
};

/** A ranked replacement proposal awaiting a person's approval (PRD 8.5). */
export type PendingReplacement = {
  artifact_id: string;
  old_item_id: string;
  category: Category;
  /** Product ids in rank order; "use the first one" picks index 0. */
  ranked_product_ids: string[];
};

/** One 3D generation job (PRD 15.1). Its `cache_key` names the GLB under public/models. */
export type ModelJob = {
  id: string;
  product_id: string;
  cache_key: string;
  status: Product["model_status"];
  glb_url: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

/** A project member with the self-assigned role and the last heartbeat the client sent. */
export type MemberRow = Member & { role: string; stage: string | null; last_seen: string };

export type AppState = {
  store: ProjectStore;
  /** Join code (six uppercase letters or digits) per project id, and the reverse lookup. */
  codes: Map<string, string>;
  codeIndex: Map<string, string>;
  members: Map<string, MemberRow>;
  spaces: Map<string, Space>;
  requirements: Map<string, Requirement>;
  boards: Map<string, unknown>;
  messages: Map<string, ChatMessage[]>;
  jobs: Map<string, ModelJob>;
  events: DomainEvent[];
  client: CatalogClient;
  runs: AgentRunStore;
  /** The one run per project that is running or waiting for user input. */
  activeRuns: Map<string, string>;
  pendingReplacements: Map<string, PendingReplacement>;
};

declare global {
  // eslint-disable-next-line no-var
  var __plannerState: AppState | undefined;
}

/** What a catalog call sends, without the merchant-sized bits: the query, price and ship-to filters, page size, ids. */
function summarizeCatalogArgs(args: Record<string, unknown>): Record<string, unknown> {
  const { query, filters, pagination, ids, id } = args as { query?: unknown; filters?: { ships_to?: unknown; price?: unknown; available?: unknown }; pagination?: unknown; ids?: unknown; id?: unknown };
  return {
    ...(query !== undefined ? { query } : {}),
    ...(filters ? { ships_to: filters.ships_to, price: filters.price, available: filters.available } : {}),
    ...(pagination !== undefined ? { pagination } : {}),
    ...(ids !== undefined ? { ids } : {}),
    ...(id !== undefined ? { id } : {})
  };
}

/** Records every catalog and storefront MCP call as a span (PRD 24) and a failed one as an issue (PRD 17). */
const traceCatalogCall: CatalogCallHook = (call, run) => {
  const kind = call.endpoint === GLOBAL_CATALOG_ENDPOINT ? "catalog" : "storefront";
  const host = new URL(call.endpoint).host;
  return withSpan(null, { kind, name: call.tool, input: { endpoint: host, ...summarizeCatalogArgs(call.args) } }, async (span) => {
    try {
      const result = (await run()) as { products?: unknown[]; product?: unknown; pagination?: unknown; messages?: unknown[] };
      span.setOutput({
        ...(result?.products ? { count: result.products.length } : {}),
        ...(result?.product !== undefined ? { found: result.product !== null } : {}),
        ...(result?.pagination !== undefined ? { pagination: result.pagination } : {}),
        ...(result?.messages?.length ? { messages: result.messages } : {})
      });
      return result as never;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      recordIssue(null, {
        source: `${kind} ${call.tool}`,
        severity: "error",
        message: `The ${call.tool} call to ${host} failed (${message}); this search returned nothing, so the category has fewer candidates until it is retried.`,
        detail: JSON.stringify(summarizeCatalogArgs(call.args))
      });
      throw e;
    }
  });
};

export function appState(): AppState {
  if (!globalThis.__plannerState) {
    const events: DomainEvent[] = [];
    const store = new ProjectStore({ emit: (e) => events.push(e) });
    globalThis.__plannerState = {
      store,
      codes: new Map(),
      codeIndex: new Map(),
      members: new Map(),
      spaces: new Map(),
      requirements: new Map(),
      boards: new Map(),
      messages: new Map(),
      jobs: new Map(),
      events,
      client: catalogClient({ onCall: traceCatalogCall }),
      runs: createInMemoryStore(),
      activeRuns: new Map(),
      pendingReplacements: new Map()
    };
  }
  return globalThis.__plannerState;
}

/** Digits and letters that survive being read aloud: no 0/O or 1/I pairs. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // pragma: allowlist secret

function newCode(taken: Map<string, string>): string {
  for (;;) {
    let code = "";
    for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (!taken.has(code)) return code;
  }
}

/** Inserts a project and mints its join code. */
export function createProject(input: Pick<Project, "name" | "budget_cents" | "required_by">): { id: string; code: string } {
  const s = appState();
  const id = s.store.newId("proj");
  s.store.insertProject({ id, ...input, currency: "USD", delivery_address_json: null, created_at: new Date().toISOString() });
  const code = newCode(s.codeIndex);
  s.codes.set(id, code);
  s.codeIndex.set(code, id);
  return { id, code };
}

export function projectCode(projectId: string): string | null {
  return appState().codes.get(projectId) ?? null;
}

/** Resolves a join code to a project and adds a member with the role the person chose. */
export function joinProject(code: string, displayName: string, role: string): MemberRow | null {
  const s = appState();
  const projectId = s.codeIndex.get(code.trim().toUpperCase());
  if (!projectId) return null;
  const member: MemberRow = {
    id: s.store.newId("mem"),
    project_id: projectId,
    user_id: s.store.newId("user"),
    display_name: displayName,
    role,
    stage: null,
    last_seen: new Date().toISOString()
  };
  s.members.set(member.id, member);
  return member;
}

export function membersFor(projectId: string): MemberRow[] {
  return [...appState().members.values()].filter((m) => m.project_id === projectId);
}

/** Records a heartbeat; false when the member is unknown (a server restart drops every member). */
export function touchMember(projectId: string, memberId: string, stage: string | null): boolean {
  const s = appState();
  const member = s.members.get(memberId);
  if (!member || member.project_id !== projectId) return false;
  s.members.set(memberId, { ...member, stage, last_seen: new Date().toISOString() });
  return true;
}

export type ProjectSnapshot = {
  project: ReturnType<ProjectStore["getProject"]>;
  space: Space | null;
  requirements: Requirement[];
  products: Product[];
  candidates: Candidate[];
  bom: { id: string; product_id: string; category: Category; quantity: number; status: string; product: Product | null }[];
  placements: Placement[];
  budget: Budget;
  messages: ChatMessage[];
};

export function snapshot(projectId: string): ProjectSnapshot {
  const s = appState();
  const project = s.store.getProject(projectId);
  const candidates = [...s.store.candidates.values()].filter((c) => c.project_id === projectId);
  const productIds = new Set(candidates.map((c) => c.product_id));
  const products = [...s.store.products.values()].filter((p) => productIds.has(p.id));
  const bom = [...s.store.bomItems.values()]
    .filter((b) => b.project_id === projectId)
    .map((b) => ({ ...b, product: s.store.products.get(b.product_id) ?? null }));
  const space = [...s.spaces.values()].find((sp) => sp.project_id === projectId) ?? null;
  const placementIds = new Set(bom.map((b) => b.id));
  return {
    project,
    space,
    requirements: [...s.requirements.values()].filter((r) => r.project_id === projectId),
    products,
    candidates,
    bom,
    placements: [...s.store.placements.values()].filter((p) => placementIds.has(p.bom_item_id)),
    budget: calculateBudget(s.store, projectId),
    messages: s.messages.get(projectId) ?? []
  };
}

/**
 * Adds a product chosen from catalog search results to a project: normalizes it, upserts the
 * global Product row, creates a selected Candidate, and regenerates the BOM. Mirrors the URL
 * ingestion path in src/domain/ingestion for a catalog object instead of a URL.
 */
export function addCatalogProduct(projectId: string, raw: unknown, category: Category, merchant: string, sourceUrl: string) {
  const s = appState();
  const fresh = normalizeCatalogProduct(raw, { merchant, sourceUrl });
  const added = s.store.mutate(() => {
    const existing = s.store.products.get(fresh.id);
    const product: Product = existing ? { ...fresh, glb_url: existing.glb_url, model_status: existing.model_status } : fresh;
    s.store.products.set(product.id, product);
    let candidate = [...s.store.candidates.values()].find((c) => c.project_id === projectId && c.product_id === product.id);
    if (!candidate) {
      candidate = {
        id: s.store.newId("cand"),
        project_id: projectId,
        product_id: product.id,
        category,
        hard_constraint_results_json: null,
        visual_evaluation_json: null,
        delivery_status: null,
        delivery_evidence_json: null,
        ranking_state: "selected",
        rank: null
      };
      s.store.candidates.set(candidate.id, candidate);
      s.store.emit({ type: "PRODUCT_ADDED", project_id: projectId, product_id: product.id, candidate_id: candidate.id });
    }
    const { budget } = regenerateBom(s.store, projectId);
    return { product, candidate, budget };
  });
  startModelGeneration(added.product);
  return added;
}

export function pushMessage(projectId: string, message: Omit<ChatMessage, "id" | "at">): ChatMessage {
  const s = appState();
  const list = s.messages.get(projectId) ?? [];
  const full: ChatMessage = { ...message, id: `m_${list.length + 1}`, at: new Date().toISOString() };
  list.push(full);
  s.messages.set(projectId, list);
  return full;
}

/**
 * Creates or updates the agent message carrying `artifact`, matched by `artifact.id`. A progress
 * artifact (sourcing, ranking) is written many times as work advances; the UI polls and re-renders.
 */
export function upsertArtifact(projectId: string, artifact: Artifact, text: string): ChatMessage {
  const s = appState();
  const list = s.messages.get(projectId) ?? [];
  const index = list.findIndex((m) => m.artifact?.id === artifact.id);
  if (index >= 0) {
    const updated: ChatMessage = { ...list[index], text, artifact };
    list[index] = updated;
    s.messages.set(projectId, list);
    return updated;
  }
  return pushMessage(projectId, { role: "agent", author: "PlanningAgent", text, artifact });
}

export function findArtifact(projectId: string, artifactId: string): Artifact | null {
  return (appState().messages.get(projectId) ?? []).find((m) => m.artifact?.id === artifactId)?.artifact ?? null;
}

export function setDeliveryAddress(projectId: string, address: DeliveryAddress): void {
  const s = appState();
  const project = s.store.getProject(projectId);
  s.store.projects.set(projectId, { ...project, delivery_address_json: address, version: project.version + 1 });
}

/** Replaces one candidate row; rows are immutable so the store's snapshot/restore keeps working. */
export function updateCandidate(candidateId: string, patch: Partial<Candidate>): Candidate {
  const s = appState();
  const current = s.store.candidates.get(candidateId);
  if (!current) throw new Error(`Candidate ${candidateId} not found`);
  const next = { ...current, ...patch };
  s.store.candidates.set(candidateId, next);
  return next;
}

export function spaceFor(projectId: string): Space | null {
  return [...appState().spaces.values()].find((sp) => sp.project_id === projectId) ?? null;
}

/** Geometry check over the project's placed, grounded BOM items (PRD 14); null without a space. */
export function geometryFor(projectId: string): LayoutCheck | null {
  const snap = snapshot(projectId);
  if (!snap.space) return null;
  const byItem = new Map(snap.placements.map((p) => [p.bom_item_id, p]));
  const items = snap.bom
    .filter((b) => b.status !== "removed" && b.product?.spatial_status === "grounded" && byItem.has(b.id))
    .map((b) => ({
      id: b.id,
      box: { width_mm: b.product!.width_mm!, depth_mm: b.product!.depth_mm!, height_mm: b.product!.height_mm! },
      placement: byItem.get(b.id)!
    }));
  const idFor = (category: Category) => snap.bom.find((b) => b.category === category && items.some((i) => i.id === b.id))?.id;
  const rug = idFor("rug");
  const table = idFor("coffee_table");
  const sofa = idFor("sofa");
  const all = rug && table && sofa;
  return checkLayout(snap.space, items, all ? rug : undefined, all ? table : undefined, all ? sofa : undefined);
}

/** Replaces a job row with the given fields and stamps `updated_at`; returns the new row. */
export function updateJob(jobId: string, patch: Partial<Omit<ModelJob, "id" | "created_at">>): ModelJob {
  const s = appState();
  const job = s.jobs.get(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  const next = { ...job, ...patch, updated_at: new Date().toISOString() };
  s.jobs.set(jobId, next);
  return next;
}
