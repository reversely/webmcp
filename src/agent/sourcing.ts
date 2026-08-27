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
import { recordIssue, withSpan, withSpanSync } from "../server/trace";
import { emptyProgress, writeQuestionArtifact, writeSourcingArtifact, type CategoryProgress, type SourcingArtifact } from "./artifacts";
import { boxOf, isAvailable, mapLimit, searchCategory, shipsToFor, upsertCandidate, type SearchOptions } from "./catalog";
import { evaluateDelivery } from "./delivery";
import { proposeLayout, rugLargeEnough, type Boxes } from "./layout";
import { evaluateVisualFit } from "./visual";

export const ADDRESS_QUESTION = "What delivery address should I use to check arrival dates?";
export const NO_WINDOW_NOTE = "No side table is known to the project yet, so the selection takes the best combination under the budget.";
export const COUNTRY_ONLY_NOTE = "Searched with the country only; delivery estimates improve after an address is set.";
const DEFAULT_REQUIRED: Category[] = ["sofa", "coffee_table", "ottoman", "rug"];
/** Candidates per category that get the (slow) visual and delivery checks. */
const EVALUATE_PER_CATEGORY = 6;
const CONCURRENCY = 4;

export type SourcingDeps = {
  search: (category: Category, options?: SearchOptions) => Promise<unknown[]>;
  evaluateDelivery: (projectId: string, candidateId: string) => Promise<unknown>;
  evaluateVisualFit: (projectId: string, candidateId: string) => Promise<VisualEvaluation | null>;
  evaluatePerCategory: number;
};

/**
 * `P_side` of PRD 8.4: the price of the side table the project already knows about, read from a
 * `side_table` candidate that is not eliminated or from an agreed `required_item` requirement
 * shaped `{ category: "side_table", price_cents }`. Null when the project names no side table,
 * in which case selection runs without a window.
 */
export function sideTablePriceFor(projectId: string): number | null {
  const s = appState();
  for (const candidate of s.store.candidates.values()) {
    if (candidate.project_id !== projectId || candidate.category !== "side_table" || candidate.ranking_state === "eliminated") continue;
    const price = s.store.products.get(candidate.product_id)?.price_cents;
    if (typeof price === "number" && price > 0) return price;
  }
  for (const r of snapshot(projectId).requirements) {
    if (r.type !== "required_item" || r.status !== "agreed") continue;
    const value = r.value_json as { category?: unknown; price_cents?: unknown } | null;
    if (value && typeof value === "object" && value.category === "side_table" && typeof value.price_cents === "number" && value.price_cents > 0) {
      return Math.round(value.price_cents);
    }
  }
  return null;
}

/** The selection window when a side table is known (PRD 8.4), otherwise null. */
export function selectionWindowFor(projectId: string): BudgetWindow | null {
  const sideTable = sideTablePriceFor(projectId);
  return sideTable === null ? null : budgetWindow(appState().store.getProject(projectId).budget_cents, sideTable);
}

/** The price range selection searches: the demo window when one exists, else everything under the budget. */
function selectionRange(cp: SourcingCheckpoint): BudgetWindow {
  return cp.window ?? { min_cents: 0, max_cents: cp.budget_cents };
}

export function defaultSourcingDeps(projectId: string): SourcingDeps {
  const s = appState();
  return {
    search: (category, options) => searchCategory(s.client, category, shipsToFor(s.store.getProject(projectId)), options),
    evaluateDelivery,
    evaluateVisualFit,
    evaluatePerCategory: EVALUATE_PER_CATEGORY
  };
}

/** Everything the delivery step needs, written to `AgentRun.pending_operation_json` before the address gate. */
export type SourcingCheckpoint = {
  step: "delivery";
  artifact_id: string;
  categories: Category[];
  budget_cents: number;
  /** PRD 8.4 window; null when the project names no side table, so selection takes the best combination under the budget. */
  window: BudgetWindow | null;
  progress: SourcingArtifact;
  /** Candidate ids per category that passed the hard filter and await delivery evidence. */
  evaluation: Partial<Record<Category, string[]>>;
};

export type SourcingOutcome =
  | { status: "complete"; subtotal_cents: number; selected: Partial<Record<Category, string>>; artifact_id: string; layout_checked: boolean }
  | { status: "waiting_for_user"; question: string; field: "delivery_address"; run_id: string }
  | { status: "no_match"; categories: Category[]; artifact_id: string };

/** The words a board note may use for each category the pipeline can source. */
const CATEGORY_WORDS: [Category, RegExp][] = [
  ["coffee_table", /\bcoffee\s*tables?\b/i],
  ["side_table", /\b(?:side|end|accent|bedside)\s*tables?\b/i],
  ["sofa", /\b(?:sofa|couch|sectional|settee|loveseat)s?\b/i],
  ["ottoman", /\b(?:ottoman|footstool|pouf|pouffe)s?\b/i],
  ["rug", /\b(?:rug|carpet)s?\b/i]
];

/** Maps a required_item value, a category id or the board's own phrase ("big rug"), to a category the pipeline can source. */
export function categoryFor(value: unknown): Category | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "_");
  if (Category.safeParse(normalized).success) return normalized as Category;
  return CATEGORY_WORDS.find(([, re]) => re.test(value))?.[0] ?? null;
}

function requiredCategories(projectId: string): Category[] {
  const rows = snapshot(projectId).requirements.filter((r) => r.type === "required_item" && r.status === "agreed");
  const categories = [...new Set(rows.map((r) => categoryFor(r.value_json)).filter((c): c is Category => c !== null))];
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

  const raws = await withSpan(projectId, { kind: "step", name: `search ${category}`, prd_ref: "PRD 9 step 3", input: { category, ...options } }, async (span) => {
    const found = await deps.search(category, options);
    span.setOutput({ found: found.length });
    return found;
  });
  progress.found += raws.length;
  progress.status = "retrieving details";
  writeProgress(projectId, cp);

  const available = withSpanSync(projectId, { kind: "step", name: `filter availability ${category}`, prd_ref: "PRD 9 step 4", input: { found: raws.length } }, (span) => {
    const kept = raws.filter(isAvailable);
    span.setOutput({ available: kept.length, dropped: raws.length - kept.length });
    return kept;
  });
  progress.available += available.length;
  progress.status = "checking dimensions";
  writeProgress(projectId, cp);

  const rows = withSpanSync(projectId, { kind: "step", name: `retrieve details ${category}`, prd_ref: "PRD 9 step 5", input: { available: available.length } }, (span) => {
    const upserted = available.flatMap((raw) => {
      try {
        return [upsertCandidate(projectId, raw, category)];
      } catch (e) {
        const title = (raw as { title?: string }).title ?? (raw as { id?: string }).id ?? "a product";
        recordIssue(projectId, { source: "step retrieve details", message: `"${title}" could not be normalized into a product card (${(e as Error).message}) and was dropped from the ${category.replace("_", " ")} search.` });
        return [];
      }
    });
    span.setOutput({ candidates: upserted.length, product_ids: upserted.map((r) => r.product.id) });
    return upserted;
  });
  withSpanSync(projectId, { kind: "step", name: `extract dimensions ${category}`, prd_ref: "PRD 9 step 6", input: { candidates: rows.length } }, (span) => {
    const grounded = rows.filter((r) => r.product.spatial_status === "grounded");
    const missing = rows.filter((r) => r.product.spatial_status !== "grounded");
    span.setOutput({ dimensioned: grounded.length, without_dimensions: missing.map((r) => ({ id: r.product.id, title: r.product.title })) });
    if (missing.length > 0) {
      const titles = missing.slice(0, 3).map((r) => `"${r.product.title}"`).join(", ");
      recordIssue(projectId, { source: "step extract dimensions", message: `${missing.length} of ${rows.length} available ${category.replace("_", " ")} products have no parsable dimensions (${titles}${missing.length > 3 ? ", …" : ""}); they are excluded from the geometry check and cannot be selected.` });
    }
  });
  progress.dimensioned += rows.filter((r) => r.product.spatial_status === "grounded").length;

  const productByCandidate = new Map(rows.map((r) => [r.candidate.id, r.product]));
  const ctx = { mode: "initial" as const, budgetWindow: selectionRange(cp), category, fits: (c: RankableCandidate) => fitsRoom(projectId, productByCandidate.get(c.id)!, category) };
  const { survivors, eliminated } = withSpanSync(projectId, { kind: "step", name: `hard constraints ${category}`, prd_ref: "PRD 9 step 7", input: { candidates: rows.length, window: ctx.budgetWindow } }, (span) => {
    const outcome = hardFilter(rows.map((r) => rankable(r.candidate, r.product)), ctx);
    span.setOutput({ survivors: outcome.survivors.length, eliminated: outcome.eliminated.map((e) => ({ id: e.candidate.id, reason: e.reason })) });
    return outcome;
  });
  for (const { candidate, reason } of eliminated) {
    updateCandidate(candidate.id, { ranking_state: "eliminated", hard_constraint_results_json: { passed: false, reason } });
  }
  for (const c of survivors) updateCandidate(c.id, { hard_constraint_results_json: { passed: true, reason: null } });
  progress.compatible += survivors.length;
  progress.status = "checking visual fit";
  writeProgress(projectId, cp);

  const evaluation = spread(survivors, deps.evaluatePerCategory);
  await withSpan(projectId, { kind: "step", name: `visual fit ${category}`, prd_ref: "PRD 9 step 8", input: { candidate_ids: evaluation.map((c) => c.id) } }, async (span) => {
    const results = await mapLimit(evaluation, CONCURRENCY, (c) => deps.evaluateVisualFit(projectId, c.id));
    span.setOutput({ pass: results.filter((r) => r?.overall === "pass").length, fail: results.filter((r) => r?.overall === "fail").length, none: results.filter((r) => !r).length });
  });
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
    await withSpan(projectId, { kind: "step", name: `delivery ${category}`, prd_ref: "PRD 9 step 9", input: { candidate_ids: ids } }, async (span) => {
      await mapLimit(ids, CONCURRENCY, async (id) => {
        await deps.evaluateDelivery(projectId, id);
        progress.delivery_checked += 1;
        writeProgress(projectId, cp);
      });
      const statuses: Record<string, number> = {};
      for (const id of ids) {
        const status = s.store.candidates.get(id)?.delivery_status ?? "unknown";
        statuses[status] = (statuses[status] ?? 0) + 1;
      }
      span.setOutput(statuses);
    });
  }
}

/** Steps 7 (delivery failures), 10, and 13: filter again with evidence, rank, persist ranks. */
function rankCategories(projectId: string, cp: SourcingCheckpoint): Partial<Record<Category, RankedCandidate[]>> {
  const s = appState();
  const ranked: Partial<Record<Category, RankedCandidate[]>> = {};
  for (const category of cp.categories) {
    const rows = (cp.evaluation[category] ?? []).map((id) => s.store.candidates.get(id)!).map((c) => rankable(c, s.store.getProduct(c.product_id)));
    const { survivors, eliminated } = hardFilter(rows, { mode: "initial", budgetWindow: selectionRange(cp), category, fits: () => true });
    for (const { candidate, reason } of eliminated) updateCandidate(candidate.id, { ranking_state: "eliminated", hard_constraint_results_json: { passed: false, reason } });
    const list = rankSurvivors(survivors, { deliveryRank: rankDeliveryConfidence });
    for (const c of list) updateCandidate(c.id, { ranking_state: "ranked", rank: c.rank });
    ranked[category] = list;
  }
  return ranked;
}

/** `rankCategories` as one `step` span: the ranked candidate cards per category (PRD 9 step 10). */
function rankCategoriesSpanned(projectId: string, cp: SourcingCheckpoint): Partial<Record<Category, RankedCandidate[]>> {
  return withSpanSync(projectId, { kind: "step", name: "rank candidates", prd_ref: "PRD 9 step 10", input: { categories: cp.categories } }, (span) => {
    const ranked = rankCategories(projectId, cp);
    span.setOutput(Object.fromEntries(Object.entries(ranked).map(([c, rows]) => [c, rows.map((r) => ({ id: r.id, rank: r.rank, price_cents: r.price_cents }))])));
    return ranked;
  });
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
 * list when none qualifies. Without a window there is no side table and no floor.
 */
export function withReplacementFloor(ranked: Partial<Record<Category, RankedCandidate[]>>, window: BudgetWindow | null, category: Category = "coffee_table"): Partial<Record<Category, RankedCandidate[]>> {
  const rows = ranked[category];
  if (!window || !rows) return ranked;
  const floorCents = window.max_cents - window.min_cents;
  const above = rows.filter((r) => r.price_cents >= floorCents);
  return above.length > 0 ? { ...ranked, [category]: above } : ranked;
}

/** Steps 11 and 12: choose the combination inside the window, mark it selected, regenerate the BOM. */
function selectAndRecord(projectId: string, cp: SourcingCheckpoint, ranked: Partial<Record<Category, RankedCandidate[]>>): { selected: Partial<Record<Category, RankedCandidate>>; subtotal_cents: number } | null {
  const s = appState();
  const result = withSpanSync(projectId, { kind: "step", name: "select combination", prd_ref: "PRD 9 step 11", input: { window: selectionRange(cp), ranked: Object.fromEntries(Object.entries(ranked).map(([c, rows]) => [c, rows.length])) } }, (span) => {
    let pick = selectCombination(ranked, cp.categories, selectionRange(cp));
    if ("no_combination" in pick && cp.window) {
      // No combination reaches the window even after the second coffee-table search (PRD 8.4): fall
      // back to the best combination under the budget so the project still gets a proposed BOM.
      pick = selectCombination(ranked, cp.categories, { min_cents: 0, max_cents: cp.budget_cents });
      span.setOutput({ fell_back_to_budget: true, ...pick });
    } else {
      span.setOutput(pick);
    }
    return pick;
  });
  if ("no_combination" in result) {
    recordIssue(projectId, { source: "step select combination", severity: "error", message: `No combination of ranked candidates fits under the budget (gap in ${result.gapCategory.replace("_", " ")}); the run ends with no proposed BOM, so widen the budget or the searches and ask again.` });
    return null;
  }
  const picks = result.selected;
  withSpanSync(projectId, { kind: "step", name: "record selection and regenerate BOM", prd_ref: "PRD 9 step 12", input: { picks: Object.fromEntries(Object.entries(picks).map(([c, p]) => [c, p.id])), subtotal_cents: result.subtotal_cents } }, (span) => {
    s.store.mutate(() => {
      for (const pick of Object.values(picks)) updateCandidate(pick.id, { ranking_state: "selected" });
      const { budget } = regenerateBom(s.store, projectId);
      span.setOutput(budget);
    });
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
  let ranked = withReplacementFloor(rankCategoriesSpanned(projectId, cp), cp.window);

  let selection = selectCombination(ranked, cp.categories, selectionRange(cp));
  if ("no_combination" in selection && cp.categories.includes(selection.gapCategory)) {
    // PRD 8.4: one more search for the gap category with the price range that closes the gap.
    const range = selection.suggestedPriceRange;
    await searchAndEvaluate(projectId, cp, selection.gapCategory, deps, { minCents: range.min_cents, maxCents: range.max_cents });
    await checkDelivery(projectId, cp, deps);
    ranked = withReplacementFloor(rankCategoriesSpanned(projectId, cp), cp.window);
    selection = selectCombination(ranked, cp.categories, selectionRange(cp));
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
  const layoutChecked = withSpanSync(projectId, { kind: "step", name: "propose layout", prd_ref: "PRD 9 step 14" }, (span) => {
    const checked = writeLayout(projectId);
    span.setOutput({ layout_checked: checked, geometry: checked ? geometryFor(projectId) : null });
    return checked;
  });
  complete(s.runs, run.id);
  s.activeRuns.delete(projectId);
  const selected: Partial<Record<Category, string>> = {};
  for (const [category, pick] of Object.entries(recorded.selected) as [Category, RankedCandidate][]) {
    const productId = s.store.candidates.get(pick.id)!.product_id;
    selected[category] = productId;
    // Step 13: 3D generation for each selected product, detached (PRD 15.1 never blocks the BOM).
    withSpanSync(projectId, { kind: "step", name: `start 3D ${category}`, prd_ref: "PRD 9 step 13", input: { product_id: productId } }, () => startModelGeneration(s.store.getProduct(productId)));
  }
  return { status: "complete", subtotal_cents: recorded.subtotal_cents, selected, artifact_id: cp.artifact_id, layout_checked: layoutChecked };
}

/** Pauses the run on a missing address (PRD 5.2): checkpoint, question artifact, `waiting_for_user`. */
function gateOnAddress(projectId: string, run: AgentRun, cp: SourcingCheckpoint): SourcingOutcome | null {
  return withSpanSync(projectId, { kind: "step", name: "address gate", prd_ref: "PRD 10", input: { run_id: run.id } }, (span) => {
    const outcome = gateOnAddressUnspanned(projectId, run, cp);
    span.setOutput({ waiting: outcome !== null });
    return outcome;
  });
}

function gateOnAddressUnspanned(projectId: string, run: AgentRun, cp: SourcingCheckpoint): SourcingOutcome | null {
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
  const window = selectionWindowFor(projectId);
  const notes = [...(window ? [] : [NO_WINDOW_NOTE]), ...(project.delivery_address_json ? [] : [COUNTRY_ONLY_NOTE])];
  const cp: SourcingCheckpoint = {
    step: "delivery",
    artifact_id: `sourcing_${run.id}`,
    categories: withSpanSync(projectId, { kind: "step", name: "identify required categories", prd_ref: "PRD 9 step 2" }, () => requiredCategories(projectId)),
    budget_cents: project.budget_cents,
    window,
    progress: { categories: {}, ...(window ? { window } : {}), ...(notes.length > 0 ? { notes } : {}) },
    evaluation: {}
  };
  try {
    return await withSpan(projectId, { kind: "domain", name: "source_room", prd_ref: "PRD 9", input: { goal, run_id: run.id, categories: cp.categories, window: cp.window } }, async () => {
      withSpanSync(projectId, { kind: "step", name: "read project spec", prd_ref: "PRD 9 step 1", input: { project_id: projectId } }, (span) =>
        span.setOutput({ budget_cents: project.budget_cents, required_by: project.required_by, has_address: Boolean(project.delivery_address_json), requirements: snapshot(projectId).requirements.length })
      );
      for (const category of cp.categories) progressOf(cp, category);
      writeProgress(projectId, cp);
      for (const category of cp.categories) await searchAndEvaluate(projectId, cp, category, deps);
      const waiting = gateOnAddress(projectId, run, cp);
      if (waiting) return waiting;
      checkpoint(s.runs, run.id, cp);
      return await finish(projectId, run, cp, deps);
    });
  } catch (e) {
    failRecoverable(s.runs, run.id, (e as Error).message);
    s.activeRuns.delete(projectId);
    recordIssue(projectId, { source: "domain source_room", severity: "error", message: `The sourcing run ${run.id} stopped with an error (${(e as Error).message}); it is marked failed_recoverable, and a new request starts the pipeline again.` });
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
    return await withSpan(projectId, { kind: "domain", name: "resume_sourcing", prd_ref: "PRD 5.2", input: { run_id: runId } }, async () => {
      const waiting = gateOnAddress(projectId, run, cp);
      if (waiting) return waiting;
      return await finish(projectId, run, cp, deps);
    });
  } catch (e) {
    failRecoverable(s.runs, run.id, (e as Error).message);
    s.activeRuns.delete(projectId);
    recordIssue(projectId, { source: "domain resume_sourcing", severity: "error", message: `The resumed sourcing run ${run.id} stopped with an error (${(e as Error).message}); it is marked failed_recoverable, and a new request starts the pipeline again.` });
    throw e;
  }
}
