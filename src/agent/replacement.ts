/**
 * Constrained replacement (PRD 8.5, 13, 13.1): search under a price ceiling, evaluate each
 * candidate at the old item's placement, rank, show the ranking artifact row by row, and on
 * approval run `replaceBomItem` against the store's current version.
 *
 * When the named item's price cannot cover the overage (#64), the flow keeps its artifact as the
 * explanation and ranks replacements for the smallest set of other required lines whose combined
 * savings reach the budget; approval then commits those lines in order, one transaction each.
 */
import { calculateBudget, replaceBomItem, VersionMismatchError, type ReplaceResult } from "../domain/bom";
import { rankDeliveryConfidence } from "../domain/delivery";
import { candidateFits, footprint, type Footprint } from "../domain/geometry";
import { formatMoney } from "../domain/money";
import { hardFilter, rankSurvivors, replacementCeiling, requiredSavings, savingsPlan, type RankableCandidate, type SavingsLine, type VisualEvaluation } from "../domain/ranking";
import { itemKey, readRequiredItem, type Category, type Decision } from "../domain/types";
import { appState, snapshot, spaceFor, updateCandidate, type AppState, type PendingReplacement, type ProjectSnapshot } from "../server/state";
import { writeRankingArtifact, type RankingArtifact, type RankingRow } from "./artifacts";
import { boxOf, dimsText, isAvailable, mapLimit, searchProducts, shipsToFor, upsertCandidate, type SearchOptions } from "./catalog";
import { evaluateDelivery } from "./delivery";
import { kindFor } from "./kinds";
import type { SourcingItem } from "./sourcing";
import { evaluateVisualFit } from "./visual";

export type ReplacementDeps = {
  search: (item: SourcingItem, options?: SearchOptions) => Promise<unknown[]>;
  evaluateDelivery: (projectId: string, candidateId: string) => Promise<unknown>;
  evaluateVisualFit: (projectId: string, candidateId: string) => Promise<VisualEvaluation | null>;
  evaluatePerCategory: number;
};

export function defaultReplacementDeps(projectId: string): ReplacementDeps {
  const s = appState();
  return {
    search: (item, options) => searchProducts(s.client, item.query, shipsToFor(s.store.getProject(projectId)), options),
    evaluateDelivery,
    evaluateVisualFit,
    evaluatePerCategory: 6
  };
}

export type RankedOption = { product_id: string; title: string; price_cents: number; rank: number; why: string[] };

/** One BOM line's ranking: the artifact that shows it and the options approval may commit. */
export type RankedLine = {
  artifact_id: string;
  old_item_id: string;
  category: Category;
  old_price_cents: number;
  required_savings_cents: number;
  ceiling_cents: number;
  ranked: RankedOption[];
};

export type ReplacementOutcome =
  | {
      status: "ranked";
      /** The named item's artifact, its full overage, and its ceiling; `lines` carries what approval replaces. */
      artifact_id: string;
      old_item_id: string;
      required_savings_cents: number;
      ceiling_cents: number;
      ranked: RankedOption[];
      lines: RankedLine[];
      explanation: string;
    }
  | { status: "no_item"; category: Category }
  | { status: "no_candidates"; artifact_id: string; required_savings_cents: number; ceiling_cents: number; explanation: string };

const APPROVAL = /\b(approve|approved|go with|use the \w+ one|use that|take the first|yes,? (do it|please|go ahead)|replace it)\b/i;
const ORDINAL = /\b(first|second|third|(\d+)(?:st|nd|rd|th))\b/i;
const ORDINALS: Record<string, number> = { first: 0, second: 1, third: 2 };

/** Which ranked option a message approves (0 = top-ranked), or null when it approves nothing. */
export function approvalIndex(text: string): number | null {
  if (!APPROVAL.test(text)) return null;
  const ordinal = ORDINAL.exec(text);
  if (!ordinal) return 0;
  return ORDINALS[ordinal[1].toLowerCase()] ?? Number.parseInt(ordinal[2], 10) - 1;
}

type BomLine = ProjectSnapshot["bom"][number];

/**
 * The lines one approval commits, in order. The state's own `pendingReplacements` slot keeps the
 * first line so the chat and the agent context still see a pending proposal; the rest live here,
 * keyed by the state object so a test reset drops them with it.
 */
const pendingLines = new WeakMap<AppState, Map<string, PendingReplacement[]>>();

function pendingFor(projectId: string): PendingReplacement[] {
  const s = appState();
  const lines = pendingLines.get(s)?.get(projectId);
  if (lines) return lines;
  const head = s.pendingReplacements.get(projectId);
  return head ? [head] : [];
}

function setPending(projectId: string, lines: PendingReplacement[]): void {
  const s = appState();
  s.pendingReplacements.set(projectId, lines[0]);
  const byProject = pendingLines.get(s) ?? new Map<string, PendingReplacement[]>();
  byProject.set(projectId, lines);
  pendingLines.set(s, byProject);
}

function clearPending(projectId: string): void {
  const s = appState();
  s.pendingReplacements.delete(projectId);
  pendingLines.get(s)?.delete(projectId);
}

function placedFootprints(projectId: string, excludeItemId: string): Footprint[] {
  const snap = snapshot(projectId);
  const byItem = new Map(snap.placements.map((p) => [p.bom_item_id, p]));
  return snap.bom
    .filter((b) => b.id !== excludeItemId && b.status !== "removed" && b.kind !== "soft_floor" && b.product && byItem.has(b.id))
    .flatMap((b) => {
      const box = boxOf(b.product!);
      return box ? [footprint(box, byItem.get(b.id)!)] : [];
    });
}

/** The cheapest price the project has seen for an item, over every candidate it holds; zero when it knows none. */
function knownFloor(projectId: string, category: Category): number {
  const s = appState();
  let floor = Number.POSITIVE_INFINITY;
  for (const candidate of s.store.candidates.values()) {
    if (candidate.project_id !== projectId || itemKey(candidate.category) !== itemKey(category)) continue;
    const price = s.store.products.get(candidate.product_id)?.price_cents;
    if (typeof price === "number" && price > 0) floor = Math.min(floor, price);
  }
  return Number.isFinite(floor) ? floor : 0;
}

function savingsLine(projectId: string, line: BomLine): SavingsLine {
  return { id: line.id, price_cents: line.product!.price_cents, floor_cents: knownFloor(projectId, line.category) };
}

/**
 * The lines a savings plan may replace besides the named one: the agreed required items' lines.
 * An item added outside that list (the pasted product of PRD 8.4) is what the people asked for
 * and stays as it is.
 */
function replaceableLines(snap: ProjectSnapshot, excludeItemId: string): BomLine[] {
  const required = new Set<string>();
  for (const row of snap.requirements) {
    if (row.type !== "required_item" || row.status !== "agreed") continue;
    const item = readRequiredItem(row.value_json);
    if (item) required.add(itemKey(item.name));
  }
  return snap.bom.filter((b) => b.id !== excludeItemId && b.status !== "removed" && b.product && required.has(itemKey(b.category)));
}

/** Searches, evaluates, and ranks cheaper products for one BOM line, writing its own ranking artifact. */
async function rankLine(projectId: string, oldItem: BomLine, savings: number, deps: ReplacementDeps): Promise<{ line: RankedLine; artifact: RankingArtifact }> {
  const s = appState();
  const snap = snapshot(projectId);
  const category = oldItem.category;
  const item: SourcingItem = { name: category, kind: oldItem.kind, query: kindFor(category).query };
  const oldPrice = oldItem.product!.price_cents;
  const ceiling = replacementCeiling(oldPrice, savings);
  const artifactId = `ranking_${oldItem.id}_${Date.now()}`;
  const artifact: RankingArtifact = { category, required_savings_cents: savings, ceiling_cents: ceiling, rows: [] };
  const write = () => writeRankingArtifact(projectId, artifactId, artifact);
  write();

  const raws = (await deps.search(item, { maxCents: ceiling })).filter(isAvailable);
  const rows = raws.flatMap((raw) => {
    try {
      const row = upsertCandidate(projectId, raw, category, item.kind);
      return row.product.id === oldItem.product_id ? [] : [row];
    } catch {
      return [];
    }
  });
  const rowFor = new Map<string, RankingRow>();
  for (const { product, candidate } of rows) {
    const row: RankingRow = {
      product_id: product.id,
      title: product.title,
      image_url: product.primary_image_url,
      price_cents: product.price_cents,
      savings_cents: oldPrice - product.price_cents,
      dims: dimsText(product),
      geometry: "pending",
      visual: "pending",
      delivery: "pending",
      status: "evaluating"
    };
    rowFor.set(candidate.id, row);
    artifact.rows.push(row);
  }
  write();

  const space = spaceFor(projectId);
  const placement = snap.placements.find((p) => p.bom_item_id === oldItem.id);
  // A soft floor item sits under the others by design (PRD 13 excludes it from overlap), so its
  // replacement is checked against the room alone.
  const others = oldItem.kind === "soft_floor" ? [] : placedFootprints(projectId, oldItem.id);
  const evaluated = rows.slice(0, deps.evaluatePerCategory);
  await mapLimit(evaluated, 4, async ({ product, candidate }) => {
    const row = rowFor.get(candidate.id)!;
    const box = boxOf(product);
    const fits = Boolean(box && (!space || candidateFits(box, space, placement, others)));
    row.geometry = fits ? "pass" : "fail";
    updateCandidate(candidate.id, { hard_constraint_results_json: { passed: fits, reason: fits ? null : "geometry_failure" } });
    write();
    if (!fits) {
      row.status = "eliminated";
      row.reason = box ? "does not fit at the current placement" : "no dimensions";
      updateCandidate(candidate.id, { ranking_state: "eliminated" });
      write();
      return;
    }
    await deps.evaluateDelivery(projectId, candidate.id);
    row.delivery = s.store.candidates.get(candidate.id)!.delivery_status ?? "unknown";
    write();
    const visual = await deps.evaluateVisualFit(projectId, candidate.id);
    row.visual = visual ? visual.overall : "pending";
    write();
  });

  const rankables: RankableCandidate[] = evaluated.map(({ product, candidate }) => ({
    id: candidate.id,
    category,
    price_cents: product.price_cents,
    delivery_status: s.store.candidates.get(candidate.id)!.delivery_status,
    visual: (s.store.candidates.get(candidate.id)!.visual_evaluation_json as VisualEvaluation | null) ?? null
  }));
  const productByCandidate = new Map(evaluated.map((r) => [r.candidate.id, r.product]));
  const { survivors, eliminated } = hardFilter(rankables, {
    mode: "replacement",
    requiredSavings_cents: savings,
    oldPrice_cents: oldPrice,
    category,
    fits: (c) => s.store.candidates.get(c.id)!.ranking_state !== "eliminated"
  });
  for (const { candidate, reason } of eliminated) {
    const row = rowFor.get(candidate.id)!;
    row.status = "eliminated";
    row.reason = reason.replace("_", " ");
    updateCandidate(candidate.id, { ranking_state: "eliminated" });
  }
  const ranked = rankSurvivors(survivors, { deliveryRank: rankDeliveryConfidence });
  for (const c of ranked) {
    const row = rowFor.get(c.id)!;
    row.status = "ranked";
    row.rank = c.rank;
    row.reason = c.why.join("; ");
    updateCandidate(c.id, { ranking_state: "ranked", rank: c.rank });
  }
  artifact.rows.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
  // PRD 13: the top-ranked survivor is the proposed replacement; approval commits it (PRD 8.5).
  const top = artifact.rows.find((row) => row.rank === 1);
  if (top) {
    top.status = "selected";
    artifact.selected_product_id = top.product_id;
  }
  write();

  const decision: Decision = {
    id: s.store.newId("dec"),
    project_id: projectId,
    actor: "PlanningAgent",
    type: "replacement_ranked",
    payload_json: { category, old_item_id: oldItem.id, required_savings_cents: savings, ceiling_cents: ceiling, ranked: ranked.map((c) => ({ candidate_id: c.id, rank: c.rank, why: c.why })) },
    created_at: new Date().toISOString()
  };
  s.store.decisions.set(decision.id, decision);

  const line: RankedLine = {
    artifact_id: artifactId,
    old_item_id: oldItem.id,
    category,
    old_price_cents: oldPrice,
    required_savings_cents: savings,
    ceiling_cents: ceiling,
    ranked: ranked.map((c) => {
      const product = productByCandidate.get(c.id)!;
      return { product_id: product.id, title: product.title, price_cents: product.price_cents, rank: c.rank, why: c.why };
    })
  };
  return { line, artifact };
}

function pendingOf(line: RankedLine): PendingReplacement {
  return { artifact_id: line.artifact_id, old_item_id: line.old_item_id, category: line.category, ranked_product_ids: line.ranked.map((r) => r.product_id) };
}

function cannotAbsorbNote(category: Category, line: SavingsLine, savings: number): string {
  const ceiling = replacementCeiling(line.price_cents, savings);
  const floor = line.floor_cents > 0 ? `, and the cheapest ${category} the project has seen costs ${formatMoney(line.floor_cents)}` : "";
  return `A cheaper ${category} cannot recover the budget on its own: it costs ${formatMoney(line.price_cents)} and the budget needs ${formatMoney(savings)} back, so a replacement would have to cost ${formatMoney(ceiling)} or less${floor}.`;
}

function planNote(shares: { line: BomLine; share_cents: number }[], savings: number): string {
  const named = shares.map(({ line }) => `${line.category} (${formatMoney(line.product!.price_cents)})`);
  if (shares.length === 1) return `Replacing the ${named[0]} instead can recover ${formatMoney(savings)}.`;
  const split = shares.map(({ line, share_cents }) => `${formatMoney(share_cents)} from the ${line.category}`).join(" and ");
  return `Replacing the ${named.join(" and the ")} together can recover ${formatMoney(savings)}: ${split}.`;
}

/**
 * Ranks cheaper products for the BOM item named `category` (the project's phrase for it, matched
 * case-insensitively) and writes the ranking artifact. When that item cannot absorb the overage,
 * its artifact explains why and the other required lines that can are ranked instead (#64).
 */
export async function findCheaperReplacement(projectId: string, category: Category, deps: ReplacementDeps = defaultReplacementDeps(projectId)): Promise<ReplacementOutcome> {
  const s = appState();
  const snap = snapshot(projectId);
  const oldItem = snap.bom.find((b) => itemKey(b.category) === itemKey(category) && b.status !== "removed" && b.product);
  if (!oldItem) return { status: "no_item", category };
  category = oldItem.category;
  const savings = requiredSavings(calculateBudget(s.store, projectId).committed_cents, snap.project.budget_cents);
  const named = savingsLine(projectId, oldItem);
  const ceiling = replacementCeiling(named.price_cents, savings);

  let namedArtifactId: string;
  let namedArtifact: RankingArtifact;
  const notes: string[] = [];
  // The catalog decides whether the named item can absorb the overage: any positive ceiling gets a
  // search, and only an empty ranking falls through to the other lines. The plan for those lines
  // has no search yet, so it reads each line's capacity from the cheapest price the project has seen.
  if (ceiling > 0) {
    const { line, artifact } = await rankLine(projectId, oldItem, savings, deps);
    if (line.ranked.length > 0) {
      setPending(projectId, [pendingOf(line)]);
      const top = line.ranked[0];
      return {
        status: "ranked",
        artifact_id: line.artifact_id,
        old_item_id: oldItem.id,
        required_savings_cents: savings,
        ceiling_cents: ceiling,
        ranked: line.ranked,
        lines: [line],
        explanation: `Replacing the ${category} with ${top.title} (${formatMoney(top.price_cents)}) saves ${formatMoney(line.old_price_cents - top.price_cents)}${savings > 0 ? ` of the ${formatMoney(savings)} the budget needs back` : ""}.`
      };
    }
    if (savings === 0) {
      return { status: "no_candidates", artifact_id: line.artifact_id, required_savings_cents: savings, ceiling_cents: ceiling, explanation: `No cheaper ${category} fits at its placement.` };
    }
    namedArtifactId = line.artifact_id;
    namedArtifact = artifact;
    notes.push(`No ${category} priced at or under ${formatMoney(ceiling)} fits: it costs ${formatMoney(named.price_cents)} and the budget needs ${formatMoney(savings)} back, so a cheaper ${category} cannot recover the budget on its own.`);
  } else {
    namedArtifactId = `ranking_${oldItem.id}_${Date.now()}`;
    namedArtifact = { category, required_savings_cents: savings, ceiling_cents: ceiling, rows: [] };
    notes.push(cannotAbsorbNote(category, named, savings));
  }
  namedArtifact.notes = notes;
  const writeNamed = () => writeRankingArtifact(projectId, namedArtifactId, namedArtifact);
  writeNamed();

  const others = replaceableLines(snap, oldItem.id);
  const plan = savingsPlan(others.map((line) => savingsLine(projectId, line)), savings);
  const lineById = new Map(others.map((line) => [line.id, line]));
  if (!plan || plan.length === 0) {
    notes.push(`No other required line, alone or paired with another, can drop by ${formatMoney(savings)}, so no replacement reaches the budget.`);
    writeNamed();
    return { status: "no_candidates", artifact_id: namedArtifactId, required_savings_cents: savings, ceiling_cents: ceiling, explanation: notes.join(" ") };
  }
  const shares = plan.map((share) => ({ line: lineById.get(share.id)!, share_cents: share.share_cents }));
  notes.push(planNote(shares, savings));
  writeNamed();

  const lines: RankedLine[] = [];
  for (const { line, share_cents } of shares) {
    lines.push((await rankLine(projectId, line, share_cents, deps)).line);
  }
  const rankedLines = lines.filter((line) => line.ranked.length > 0);
  const short = lines.filter((line) => line.ranked.length === 0).map((line) => `no ${line.category} priced at or under ${formatMoney(line.ceiling_cents)} fits`);
  if (rankedLines.length === 0) {
    notes.push(`The plan found no candidates: ${short.join("; ")}.`);
    writeNamed();
    return { status: "no_candidates", artifact_id: namedArtifactId, required_savings_cents: savings, ceiling_cents: ceiling, explanation: notes.join(" ") };
  }
  if (short.length > 0) {
    notes.push(`Part of the plan has no candidate (${short.join("; ")}), so approving the rest recovers less than ${formatMoney(savings)}.`);
    writeNamed();
  }
  setPending(projectId, rankedLines.map(pendingOf));
  const picks = rankedLines.map((line) => `${line.category} with ${line.ranked[0].title} (${formatMoney(line.ranked[0].price_cents)}, saves ${formatMoney(line.old_price_cents - line.ranked[0].price_cents)})`);
  return {
    status: "ranked",
    artifact_id: namedArtifactId,
    old_item_id: oldItem.id,
    required_savings_cents: savings,
    ceiling_cents: ceiling,
    ranked: [],
    lines: rankedLines,
    explanation: `${notes.join(" ")} Top options: replace the ${picks.join("; and the ")}.`
  };
}

export type ReplacedLine = { old_item_id: string; category: Category; product_id: string; result: ReplaceResult };

export type ApprovalOutcome =
  | { status: "replaced"; result: ReplaceResult; product_id: string; replaced: ReplacedLine[] }
  | { status: "nothing_pending" }
  | { status: "stale_version"; message: string };

function markSelected(projectId: string, artifactId: string, productId: string): void {
  const message = appState().messages.get(projectId)?.find((m) => m.artifact?.id === artifactId);
  if (!message?.artifact) return;
  const data = message.artifact.data as RankingArtifact;
  data.selected_product_id = productId;
  for (const row of data.rows) {
    if (row.product_id === productId) row.status = "selected";
    else if (row.status === "selected") row.status = "ranked";
  }
  writeRankingArtifact(projectId, artifactId, data);
}

/**
 * Runs the replacement transaction for the ranked option at `index` (0 = the top-ranked one) on
 * every pending line, in plan order, each as its own `replaceBomItem` transaction.
 */
export function approveReplacement(projectId: string, index: number, actor: string): ApprovalOutcome {
  const s = appState();
  const pending = pendingFor(projectId);
  if (pending.length === 0) return { status: "nothing_pending" };
  const replaced: ReplacedLine[] = [];
  try {
    for (const line of pending) {
      const productId = line.ranked_product_ids[Math.min(Math.max(index, 0), line.ranked_product_ids.length - 1)];
      const result = replaceBomItem(s.store, {
        projectId,
        expectedVersion: s.store.getProject(projectId).version,
        oldItemId: line.old_item_id,
        newProductId: productId,
        actor
      });
      replaced.push({ old_item_id: line.old_item_id, category: line.category, product_id: productId, result });
      markSelected(projectId, line.artifact_id, productId);
    }
  } catch (e) {
    if (e instanceof VersionMismatchError) return { status: "stale_version", message: e.message };
    throw e;
  }
  clearPending(projectId);
  const last = replaced[replaced.length - 1];
  return { status: "replaced", result: last.result, product_id: replaced[0].product_id, replaced };
}
