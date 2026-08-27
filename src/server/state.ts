/**
 * Server-side application state for the prototype: one in-memory ProjectStore plus the tables the
 * BOM store does not own (spaces, requirements, board documents, chat messages). Kept on
 * `globalThis` so Next.js dev-server module reloads do not wipe it. Postgres replaces this (#15).
 */
import { catalogClient, GLOBAL_CATALOG_ENDPOINT, type CatalogCallHook, type CatalogClient } from "../commerce";
import { createInMemoryStore, type AgentRunStore } from "../domain/agent-run";
import { calculateBudget, regenerateBom, renameItem, renameItemInRule, replaceBomItem, ProjectStore, type Budget, type DomainEvent, type RenameResult, type ReplaceResult } from "../domain/bom";
import { startModelGeneration } from "../domain/ingestion/hooks";
import { normalizeCatalogProduct } from "../domain/products/normalize";
import { checkLayout, type LayoutCheck, type LayoutItem } from "../domain/geometry";
import { recordIssue, withSpan } from "./trace";
import { itemKey, readLayoutRule, readRequiredItem, type Candidate, type Category, type DeliveryAddress, type Kind, type LayoutRule, type Member, type Placement, type Product, type Project, type Requirement, type Space } from "../domain/types";

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
  /** The project's phrase for the item being replaced. */
  category: Category;
  /** Product ids in rank order; "use the first one" picks index 0. */
  ranked_product_ids: string[];
};

/** The steps a 3D job passes through, in order; `ready` or `proxy` ends it (#49). */
export type ModelStageName = "queued" | "image_fetched" | "mesh_generated" | "normalized" | "verified" | "ready" | "proxy";

/** One recorded step of a job: when it happened and, where the step measured something, what. */
export type ModelStage = { name: ModelStageName; at: string; detail?: string };

/** One 3D generation job (PRD 15.1). Its `cache_key` names the GLB under public/models. */
export type ModelJob = {
  id: string;
  product_id: string;
  cache_key: string;
  status: Product["model_status"];
  glb_url: string | null;
  error: string | null;
  /** Every stage reached so far, oldest first; the last one is the current stage. */
  stages: ModelStage[];
  /** Milliseconds from the `queued` stage to the latest stage. */
  elapsed_ms: number;
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
  /** Inferred rendering kind and search query per item phrase, keyed by `itemKey` (src/agent/kinds.ts). */
  kinds: Map<string, { kind: Kind; query: string }>;
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
      pendingReplacements: new Map(),
      kinds: new Map()
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
  bom: { id: string; product_id: string; category: Category; kind: Kind; quantity: number; status: string; product: Product | null }[];
  placements: Placement[];
  budget: Budget;
  messages: ChatMessage[];
  /** The newest 3D job per product id, for the products in this snapshot (#49). */
  model_jobs: Record<string, ModelJob>;
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
  // Jobs insert in creation order, so the last one per product is the newest (a retry after proxy).
  const model_jobs: Record<string, ModelJob> = {};
  for (const job of s.jobs.values()) if (productIds.has(job.product_id)) model_jobs[job.product_id] = job;
  return {
    project,
    space,
    requirements: [...s.requirements.values()].filter((r) => r.project_id === projectId),
    products,
    candidates,
    bom,
    placements: [...s.store.placements.values()].filter((p) => placementIds.has(p.bom_item_id)),
    budget: calculateBudget(s.store, projectId),
    messages: s.messages.get(projectId) ?? [],
    model_jobs
  };
}

/**
 * Adds a product chosen from catalog search results to a project: normalizes it, upserts the
 * global Product row, creates a selected Candidate, and regenerates the BOM. Mirrors the URL
 * ingestion path in src/domain/ingestion for a catalog object instead of a URL.
 */
export function addCatalogProduct(projectId: string, raw: unknown, category: Category, kind: Kind, merchant: string, sourceUrl: string) {
  const s = appState();
  const added = s.store.mutate(() => {
    const product = upsertCatalogProduct(raw, merchant, sourceUrl);
    let candidate = [...s.store.candidates.values()].find((c) => c.project_id === projectId && c.product_id === product.id);
    if (!candidate) {
      candidate = {
        id: s.store.newId("cand"),
        project_id: projectId,
        product_id: product.id,
        category,
        kind,
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

/** Normalizes a catalog object into the global Product row, keeping the 3D fields of a row already ingested. */
function upsertCatalogProduct(raw: unknown, merchant: string, sourceUrl: string): Product {
  const s = appState();
  const fresh = normalizeCatalogProduct(raw, { merchant, sourceUrl });
  const existing = s.store.products.get(fresh.id);
  const product: Product = existing ? { ...fresh, glb_url: existing.glb_url, model_status: existing.model_status } : fresh;
  s.store.products.set(product.id, product);
  return product;
}

/**
 * Swaps one BOM line for a product chosen from catalog search results (#48): upserts the Product
 * row, then runs the replacement transaction (PRD 8.5) at the project's current version, so the new
 * line inherits the old line's phrase, kind, and placement.
 */
export function swapCatalogProduct(projectId: string, raw: unknown, oldItemId: string, merchant: string, sourceUrl: string, actor: string): ReplaceResult & { product: Product } {
  const s = appState();
  const swapped = s.store.mutate(() => {
    const product = upsertCatalogProduct(raw, merchant, sourceUrl);
    const result = replaceBomItem(s.store, { projectId, expectedVersion: s.store.getProject(projectId).version, oldItemId, newProductId: product.id, actor });
    return { ...result, product };
  });
  startModelGeneration(swapped.product);
  return swapped;
}

/**
 * Renames an item across the project (#48): the BOM line and candidates through the domain
 * operation, then the agreed `required_item` row that named it and every layout rule that refers
 * to it, so the plan's rule marks and the search panel's item list follow the new phrase. The
 * inferred kind and search query cached under the old phrase carry over to the new one.
 */
export function renameProjectItem(projectId: string, bomItemId: string, name: string): RenameResult {
  const s = appState();
  const result = renameItem(s.store, bomItemId, name);
  const oldKey = itemKey(result.old_name);
  for (const r of s.requirements.values()) {
    if (r.project_id !== projectId) continue;
    if (r.type === "required_item") {
      const item = readRequiredItem(r.value_json);
      if (item && itemKey(item.name) === oldKey) s.requirements.set(r.id, { ...r, value_json: { ...item, name: result.name } });
    } else if (r.type === "layout_requirement") {
      const rule = readLayoutRule(r.value_json);
      if (rule) s.requirements.set(r.id, { ...r, value_json: renameItemInRule(rule, result.old_name, result.name) });
    }
  }
  const guess = s.kinds.get(oldKey);
  if (guess && !s.kinds.has(itemKey(result.name))) s.kinds.set(itemKey(result.name), guess);
  return result;
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

/**
 * Changes the rendering kind of a candidate and of the BOM item that carries its product (PRD 20:
 * a person edits the kind the agent inferred). Null when the candidate is not in the project.
 */
export function setCandidateKind(projectId: string, candidateId: string, kind: Kind): Candidate | null {
  const s = appState();
  const candidate = s.store.candidates.get(candidateId);
  if (!candidate || candidate.project_id !== projectId) return null;
  const next = updateCandidate(candidateId, { kind });
  for (const item of s.store.bomItems.values()) {
    if (item.project_id === projectId && item.product_id === candidate.product_id) s.store.bomItems.set(item.id, { ...item, kind });
  }
  s.store.markChanged(projectId);
  return next;
}

/** The project's agreed layout rules (PRD 16), in requirement order; unreadable values are skipped. */
export function layoutRulesFor(projectId: string): LayoutRule[] {
  return snapshot(projectId)
    .requirements.filter((r) => r.type === "layout_requirement" && r.status === "agreed")
    .map((r) => readLayoutRule(r.value_json))
    .filter((rule): rule is LayoutRule => rule !== null);
}

export function spaceFor(projectId: string): Space | null {
  return [...appState().spaces.values()].find((sp) => sp.project_id === projectId) ?? null;
}

/** Geometry check over the project's placed, grounded BOM items and its layout rules (PRD 14); null without a space. */
export function geometryFor(projectId: string): LayoutCheck | null {
  const snap = snapshot(projectId);
  if (!snap.space) return null;
  const byItem = new Map(snap.placements.map((p) => [p.bom_item_id, p]));
  const items: LayoutItem[] = snap.bom
    .filter((b) => b.status !== "removed" && b.product?.spatial_status === "grounded" && byItem.has(b.id))
    .map((b) => ({
      id: b.id,
      name: b.category,
      kind: b.kind,
      box: { width_mm: b.product!.width_mm!, depth_mm: b.product!.depth_mm!, height_mm: b.product!.height_mm! },
      placement: byItem.get(b.id)!
    }));
  return checkLayout(snap.space, items, layoutRulesFor(projectId));
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
