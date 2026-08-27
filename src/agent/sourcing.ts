/**
 * The sourcing pipeline of PRD 9 as deterministic server code. The PlanningAgent triggers it
 * through one tool; the fourteen steps run here, the sourcing artifact updates after each, and
 * the run checkpoints before the first delivery check so a missing address can pause it
 * (PRD 5.2, 10) and a later message can resume it from the delivery step.
 */
import { checkpoint, complete, failRecoverable, requestInput, startRun } from "../domain/agent-run";
import { regenerateBom } from "../domain/bom";
import { rankDeliveryConfidence } from "../domain/delivery";
import { startModelGeneration } from "../domain/ingestion/hooks";
import { candidateFits, type FloorPlacement } from "../domain/geometry";
import {
  budgetWindow,
  hardFilter,
  rankSurvivors,
  selectCombination,
  type BudgetWindow,
  type RankableCandidate,
  type RankedCandidate,
  type VisualEvaluation
} from "../domain/ranking";
import { Category, type AgentRun, type Candidate, type Placement, type Product } from "../domain/types";
import { appState, geometryFor, snapshot, spaceFor, updateCandidate } from "../server/state";
import { emptyProgress, writeQuestionArtifact, writeSourcingArtifact, type CategoryProgress, type SourcingArtifact } from "./artifacts";
import { boxOf, isAvailable, mapLimit, searchCategory, shipsToFor, upsertCandidate, type SearchOptions } from "./catalog";
import { evaluateDelivery } from "./delivery";
import { proposeLayout, rugLargeEnough, type Boxes } from "./layout";
import { evaluateVisualFit } from "./visual";

export const ADDRESS_QUESTION = "What delivery address should I use to check arrival dates?";
export const DEFAULT_SIDE_TABLE_PRICE_CENTS = 29500;
const DEFAULT_REQUIRED: Category[] = ["sofa", "coffee_table", "ottoman", "rug"];
/** Candidates per category that get the (slow) visual and delivery checks. */
const EVALUATE_PER_CATEGORY = 6;
const CONCURRENCY = 4;

export type SourcingDeps = {
  search: (category: Category, options?: SearchOptions) => Promise<unknown[]>;
  evaluateDelivery: (projectId: string, candidateId: string) => Promise<unknown>;
  evaluateVisualFit: (projectId: string, candidateId: string) => Promise<VisualEvaluation | null>;
  sideTablePriceCents: number;
  evaluatePerCategory: number;
};

/** The pasted side table's price (PRD 8.4) comes from the environment so the demo can pin it. */
export function sideTablePriceCents(): number {
  const raw = Number(process.env.SIDE_TABLE_PRICE_CENTS);
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : DEFAULT_SIDE_TABLE_PRICE_CENTS;
}

export function defaultSourcingDeps(projectId: string): SourcingDeps {
  const s = appState();
  return {
    search: (category, options) => searchCategory(s.client, category, shipsToFor(s.store.getProject(projectId)), options),
    evaluateDelivery,
    evaluateVisualFit,
    sideTablePriceCents: sideTablePriceCents(),
    evaluatePerCategory: EVALUATE_PER_CATEGORY
  };
}

/** Everything the delivery step needs, written to `AgentRun.pending_operation_json` before the address gate. */
export type SourcingCheckpoint = {
  step: "delivery";
  artifact_id: string;
  categories: Category[];
  window: BudgetWindow;
  progress: SourcingArtifact;
  /** Candidate ids per category that passed the hard filter and await delivery evidence. */
  evaluation: Partial<Record<Category, string[]>>;
};

export type SourcingOutcome =
  | { status: "complete"; subtotal_cents: number; selected: Partial<Record<Category, string>>; artifact_id: string; layout_checked: boolean }
  | { status: "waiting_for_user"; question: string; field: "delivery_address"; run_id: string }
  | { status: "no_match"; categories: Category[]; artifact_id: string };

function requiredCategories(projectId: string): Category[] {
  const rows = snapshot(projectId).requirements.filter((r) => r.type === "required_item" && r.status === "agreed");
  const categories = rows.map((r) => r.value_json).filter((v): v is Category => Category.safeParse(v).success);
  return categories.length > 0 ? categories : DEFAULT_REQUIRED;
}

function writeProgress(projectId: string, cp: SourcingCheckpoint): void {
  writeSourcingArtifact(projectId, cp.artifact_id, cp.progress);
}

function progressOf(cp: SourcingCheckpoint, category: Category): CategoryProgress {
  return (cp.progress.categories[category] ??= emptyProgress());
}

/** Evenly spaced picks across the price-sorted survivors, so selection sees cheap and dear options. */
function spread<T extends { price_cents: number }>(items: T[], count: number): T[] {
  const sorted = [...items].sort((a, b) => a.price_cents - b.price_cents);
  if (sorted.length <= count) return sorted;
  const picks: T[] = [];
  for (let i = 0; i < count; i++) picks.push(sorted[Math.round((i * (sorted.length - 1)) / (count - 1))]);
  return [...new Set(picks)];
}

function rankable(candidate: Candidate, product: Product): RankableCandidate {
  return {
    id: candidate.id,
    category: candidate.category,
    price_cents: product.price_cents,
    delivery_status: candidate.delivery_status,
    visual: (candidate.visual_evaluation_json as VisualEvaluation | null) ?? null
  };
}

function fitsRoom(projectId: string, product: Product, category: Category): boolean {
  const space = spaceFor(projectId);
  const box = boxOf(product);
  if (!box) return false;
  if (category === "rug" && !rugLargeEnough(box)) return false;
  return space ? candidateFits(box, space, undefined, []) : true;
}

/**
 * Steps 3 to 8 for one category: search, availability, details, dimensions, hard constraints,
 * visual fit. Leaves the candidates that survive in `cp.evaluation[category]`.
 */
async function searchAndEvaluate(projectId: string, cp: SourcingCheckpoint, category: Category, deps: SourcingDeps, options: SearchOptions = {}): Promise<void> {
  const progress = progressOf(cp, category);
  progress.status = "searching";
  writeProgress(projectId, cp);

  const raws = await deps.search(category, options);
  progress.found += raws.length;
  progress.status = "retrieving details";
  writeProgress(projectId, cp);

  const available = raws.filter(isAvailable);
  progress.available += available.length;
  progress.status = "checking dimensions";
  writeProgress(projectId, cp);

  const rows = available.flatMap((raw) => {
    try {
      return [upsertCandidate(projectId, raw, category)];
    } catch {
      return [];
    }
  });
  progress.dimensioned += rows.filter((r) => r.product.spatial_status === "grounded").length;

  const productByCandidate = new Map(rows.map((r) => [r.candidate.id, r.product]));
  const ctx = { mode: "initial" as const, budgetWindow: cp.window, category, fits: (c: RankableCandidate) => fitsRoom(projectId, productByCandidate.get(c.id)!, category) };
  const { survivors, eliminated } = hardFilter(rows.map((r) => rankable(r.candidate, r.product)), ctx);
  for (const { candidate, reason } of eliminated) {
    updateCandidate(candidate.id, { ranking_state: "eliminated", hard_constraint_results_json: { passed: false, reason } });
  }
  for (const c of survivors) updateCandidate(c.id, { hard_constraint_results_json: { passed: true, reason: null } });
  progress.compatible += survivors.length;
  progress.status = "checking visual fit";
  writeProgress(projectId, cp);

  const evaluation = spread(survivors, deps.evaluatePerCategory);
  await mapLimit(evaluation, CONCURRENCY, (c) => deps.evaluateVisualFit(projectId, c.id));
  cp.evaluation[category] = [...(cp.evaluation[category] ?? []), ...evaluation.map((c) => c.id)];
  progress.status = "checking delivery";
  writeProgress(projectId, cp);
}

/** Step 9 for every category still awaiting evidence. Each candidate is checked once. */
async function checkDelivery(projectId: string, cp: SourcingCheckpoint, deps: SourcingDeps): Promise<void> {
  const s = appState();
  for (const category of Object.keys(cp.evaluation) as Category[]) {
    const ids = (cp.evaluation[category] ?? []).filter((id) => s.store.candidates.get(id)?.delivery_status === null);
    const progress = progressOf(cp, category);
    progress.status = "checking delivery";
    writeProgress(projectId, cp);
    await mapLimit(ids, CONCURRENCY, async (id) => {
      await deps.evaluateDelivery(projectId, id);
      progress.delivery_checked += 1;
      writeProgress(projectId, cp);
    });
  }
}

/** Steps 7 (delivery failures), 10, and 13: filter again with evidence, rank, persist ranks. */
function rankCategories(projectId: string, cp: SourcingCheckpoint): Partial<Record<Category, RankedCandidate[]>> {
  const s = appState();
  const ranked: Partial<Record<Category, RankedCandidate[]>> = {};
  for (const category of cp.categories) {
    const rows = (cp.evaluation[category] ?? []).map((id) => s.store.candidates.get(id)!).map((c) => rankable(c, s.store.getProduct(c.product_id)));
    const { survivors, eliminated } = hardFilter(rows, { mode: "initial", budgetWindow: cp.window, category, fits: () => true });
    for (const { candidate, reason } of eliminated) updateCandidate(candidate.id, { ranking_state: "eliminated", hard_constraint_results_json: { passed: false, reason } });
    const list = rankSurvivors(survivors, { deliveryRank: rankDeliveryConfidence });
    for (const c of list) updateCandidate(c.id, { ranking_state: "ranked", rank: c.rank });
    ranked[category] = list;
  }
  return ranked;
}

/** Step 14: place the BOM products and store the placements; returns whether the layout was checked. */
export function writeLayout(projectId: string): boolean {
  const s = appState();
  const space = spaceFor(projectId);
  if (!space) return false;
  const snap = snapshot(projectId);
  const boxes: Boxes = {};
  const itemByCategory: Partial<Record<Category, string>> = {};
  for (const item of snap.bom) {
    if (item.status === "removed" || !item.product || itemByCategory[item.category]) continue;
    const box = boxOf(item.product);
    if (!box) continue;
    boxes[item.category] = box;
    itemByCategory[item.category] = item.id;
  }
  const layout = proposeLayout(space, boxes);
  const existing = new Map([...s.store.placements.values()].map((p) => [p.bom_item_id, p]));
  for (const [category, placement] of Object.entries(layout) as [Category, FloorPlacement][]) {
    const itemId = itemByCategory[category]!;
    const row: Placement = { id: existing.get(itemId)?.id ?? s.store.newId("pl"), space_id: space.id, bom_item_id: itemId, x_mm: placement.x_mm, y_mm: placement.y_mm, z_mm: 0, rotation_deg: placement.rotation_deg };
    s.store.placements.set(row.id, row);
  }
  return geometryFor(projectId) !== null;
}

/**
 * PRD 8.4 guarantees the side table pushes the project over budget; PRD 8.5 then replaces the
 * coffee table to get back under. That only works when the coffee table costs at least the side
 * table's price, so selection prefers coffee tables above that floor and falls back to the full
 * list when none qualifies.
 */
export function withReplacementFloor(ranked: Partial<Record<Category, RankedCandidate[]>>, floorCents: number, category: Category = "coffee_table"): Partial<Record<Category, RankedCandidate[]>> {
  const rows = ranked[category];
  if (!rows) return ranked;
  const above = rows.filter((r) => r.price_cents >= floorCents);
  return above.length > 0 ? { ...ranked, [category]: above } : ranked;
}

/** Steps 11 and 12: choose the combination inside the window, mark it selected, regenerate the BOM. */
function selectAndRecord(projectId: string, cp: SourcingCheckpoint, ranked: Partial<Record<Category, RankedCandidate[]>>): { selected: Partial<Record<Category, RankedCandidate>>; subtotal_cents: number } | null {
  const s = appState();
  let result = selectCombination(ranked, cp.categories, cp.window);
  if ("no_combination" in result) {
    // No combination reaches the window even after the second coffee-table search (PRD 8.4): fall
    // back to the best combination under the budget so the project still gets a proposed BOM.
    result = selectCombination(ranked, cp.categories, { min_cents: 0, max_cents: cp.window.max_cents });
  }
  if ("no_combination" in result) return null;
  const picks = result.selected;
  s.store.mutate(() => {
    for (const pick of Object.values(picks)) updateCandidate(pick.id, { ranking_state: "selected" });
    regenerateBom(s.store, projectId);
  });
  for (const [category, pick] of Object.entries(picks) as [Category, RankedCandidate][]) {
    const progress = progressOf(cp, category);
    progress.status = "selected";
    progress.selected_product_id = s.store.candidates.get(pick.id)!.product_id;
  }
  cp.progress.subtotal_cents = result.subtotal_cents;
  writeProgress(projectId, cp);
  return { selected: picks, subtotal_cents: result.subtotal_cents };
}

async function finish(projectId: string, run: AgentRun, cp: SourcingCheckpoint, deps: SourcingDeps): Promise<SourcingOutcome> {
  const s = appState();
  await checkDelivery(projectId, cp, deps);
  const floor = cp.window.max_cents - cp.window.min_cents;
  let ranked = withReplacementFloor(rankCategories(projectId, cp), floor);

  let selection = selectCombination(ranked, cp.categories, cp.window);
  if ("no_combination" in selection && cp.categories.includes(selection.gapCategory)) {
    // PRD 8.4: one more search for the gap category with the price range that closes the gap.
    const range = selection.suggestedPriceRange;
    await searchAndEvaluate(projectId, cp, selection.gapCategory, deps, { minCents: range.min_cents, maxCents: range.max_cents });
    await checkDelivery(projectId, cp, deps);
    ranked = withReplacementFloor(rankCategories(projectId, cp), floor);
    selection = selectCombination(ranked, cp.categories, cp.window);
  }

  const recorded = selectAndRecord(projectId, cp, ranked);
  if (!recorded) {
    const missing = cp.categories.filter((c) => (ranked[c] ?? []).length === 0);
    for (const c of cp.categories) progressOf(cp, c).status = (ranked[c] ?? []).length === 0 ? "no match" : "selected";
    writeProgress(projectId, cp);
    complete(s.runs, run.id);
    s.activeRuns.delete(projectId);
    return { status: "no_match", categories: missing.length > 0 ? missing : ["coffee_table"], artifact_id: cp.artifact_id };
  }
  const layoutChecked = writeLayout(projectId);
  complete(s.runs, run.id);
  s.activeRuns.delete(projectId);
  const selected: Partial<Record<Category, string>> = {};
  for (const [category, pick] of Object.entries(recorded.selected) as [Category, RankedCandidate][]) {
    const productId = s.store.candidates.get(pick.id)!.product_id;
    selected[category] = productId;
    // Step 13: 3D generation for each selected product, detached (PRD 15.1 never blocks the BOM).
    startModelGeneration(s.store.getProduct(productId));
  }
  return { status: "complete", subtotal_cents: recorded.subtotal_cents, selected, artifact_id: cp.artifact_id, layout_checked: layoutChecked };
}

/** Pauses the run on a missing address (PRD 5.2): checkpoint, question artifact, `waiting_for_user`. */
function gateOnAddress(projectId: string, run: AgentRun, cp: SourcingCheckpoint): SourcingOutcome | null {
  const s = appState();
  if (s.store.getProject(projectId).delivery_address_json) return null;
  checkpoint(s.runs, run.id, cp);
  requestInput(s.runs, run.id, { field: "delivery_address", question: ADDRESS_QUESTION });
  writeQuestionArtifact(projectId, `question_${run.id}`, { run_id: run.id, field: "delivery_address", question: ADDRESS_QUESTION });
  return { status: "waiting_for_user", question: ADDRESS_QUESTION, field: "delivery_address", run_id: run.id };
}

/** Runs the pipeline from step 1 under a new AgentRun whose goal is the person's request. */
export async function sourceRoom(projectId: string, goal: string, deps: SourcingDeps = defaultSourcingDeps(projectId)): Promise<SourcingOutcome> {
  const s = appState();
  const project = s.store.getProject(projectId);
  const run = startRun(s.runs, { projectId, goal });
  s.activeRuns.set(projectId, run.id);
  const cp: SourcingCheckpoint = {
    step: "delivery",
    artifact_id: `sourcing_${run.id}`,
    categories: requiredCategories(projectId),
    window: budgetWindow(project.budget_cents, deps.sideTablePriceCents),
    progress: { categories: {}, window: budgetWindow(project.budget_cents, deps.sideTablePriceCents) },
    evaluation: {}
  };
  try {
    for (const category of cp.categories) progressOf(cp, category);
    writeProgress(projectId, cp);
    for (const category of cp.categories) await searchAndEvaluate(projectId, cp, category, deps);
    const waiting = gateOnAddress(projectId, run, cp);
    if (waiting) return waiting;
    checkpoint(s.runs, run.id, cp);
    return await finish(projectId, run, cp, deps);
  } catch (e) {
    failRecoverable(s.runs, run.id, (e as Error).message);
    s.activeRuns.delete(projectId);
    throw e;
  }
}

/** Continues a run that paused at the address gate, from its checkpoint (PRD 5.2). */
export async function resumeSourcing(projectId: string, runId: string, deps: SourcingDeps = defaultSourcingDeps(projectId)): Promise<SourcingOutcome> {
  const s = appState();
  const run = s.runs.get(runId);
  if (!run) throw new Error(`Agent run ${runId} not found`);
  const cp = run.pending_operation_json as SourcingCheckpoint | null;
  if (!cp || cp.step !== "delivery") throw new Error(`Agent run ${runId} has no sourcing checkpoint`);
  try {
    const waiting = gateOnAddress(projectId, run, cp);
    if (waiting) return waiting;
    return await finish(projectId, run, cp, deps);
  } catch (e) {
    failRecoverable(s.runs, run.id, (e as Error).message);
    s.activeRuns.delete(projectId);
    throw e;
  }
}
