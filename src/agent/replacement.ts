/**
 * Constrained replacement (PRD 8.5, 13, 13.1): search under a price ceiling, evaluate each
 * candidate at the old item's placement, rank, show the ranking artifact row by row, and on
 * approval run `replaceBomItem` against the store's current version.
 */
import { calculateBudget, replaceBomItem, VersionMismatchError, type ReplaceResult } from "../domain/bom";
import { rankDeliveryConfidence } from "../domain/delivery";
import { candidateFits, footprint, type Footprint } from "../domain/geometry";
import { hardFilter, rankSurvivors, replacementCeiling, requiredSavings, type RankableCandidate, type VisualEvaluation } from "../domain/ranking";
import { itemKey, type Category, type Decision } from "../domain/types";
import { appState, snapshot, spaceFor, updateCandidate, type PendingReplacement } from "../server/state";
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

export type ReplacementOutcome =
  | { status: "ranked"; artifact_id: string; old_item_id: string; required_savings_cents: number; ceiling_cents: number; ranked: { product_id: string; title: string; price_cents: number; rank: number; why: string[] }[] }
  | { status: "no_item"; category: Category }
  | { status: "no_candidates"; artifact_id: string; required_savings_cents: number; ceiling_cents: number };

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

/**
 * Ranks cheaper products for the BOM item named `category` (the project's phrase for it, matched
 * case-insensitively) and writes the ranking artifact.
 */
export async function findCheaperReplacement(projectId: string, category: Category, deps: ReplacementDeps = defaultReplacementDeps(projectId)): Promise<ReplacementOutcome> {
  const s = appState();
  const snap = snapshot(projectId);
  const oldItem = snap.bom.find((b) => itemKey(b.category) === itemKey(category) && b.status !== "removed" && b.product);
  if (!oldItem) return { status: "no_item", category };
  category = oldItem.category;
  const item: SourcingItem = { name: category, kind: oldItem.kind, query: kindFor(category).query };
  const oldPrice = oldItem.product!.price_cents;
  const savings = requiredSavings(calculateBudget(s.store, projectId).committed_cents, snap.project.budget_cents);
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
  const others = placedFootprints(projectId, oldItem.id);
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

  if (ranked.length === 0) return { status: "no_candidates", artifact_id: artifactId, required_savings_cents: savings, ceiling_cents: ceiling };
  const pending: PendingReplacement = { artifact_id: artifactId, old_item_id: oldItem.id, category, ranked_product_ids: ranked.map((c) => productByCandidate.get(c.id)!.id) };
  s.pendingReplacements.set(projectId, pending);
  return {
    status: "ranked",
    artifact_id: artifactId,
    old_item_id: oldItem.id,
    required_savings_cents: savings,
    ceiling_cents: ceiling,
    ranked: ranked.map((c) => {
      const product = productByCandidate.get(c.id)!;
      return { product_id: product.id, title: product.title, price_cents: product.price_cents, rank: c.rank, why: c.why };
    })
  };
}

export type ApprovalOutcome =
  | { status: "replaced"; result: ReplaceResult; product_id: string }
  | { status: "nothing_pending" }
  | { status: "stale_version"; message: string };

/** Runs the replacement transaction for the ranked option at `index` (0 = the top-ranked one). */
export function approveReplacement(projectId: string, index: number, actor: string): ApprovalOutcome {
  const s = appState();
  const pending = s.pendingReplacements.get(projectId);
  if (!pending) return { status: "nothing_pending" };
  const productId = pending.ranked_product_ids[Math.min(Math.max(index, 0), pending.ranked_product_ids.length - 1)];
  try {
    const result = replaceBomItem(s.store, {
      projectId,
      expectedVersion: s.store.getProject(projectId).version,
      oldItemId: pending.old_item_id,
      newProductId: productId,
      actor
    });
    s.pendingReplacements.delete(projectId);
    const message = s.messages.get(projectId)?.find((m) => m.artifact?.id === pending.artifact_id);
    if (message?.artifact) {
      const data = message.artifact.data as RankingArtifact;
      data.selected_product_id = productId;
      for (const row of data.rows) {
        if (row.product_id === productId) row.status = "selected";
        else if (row.status === "selected") row.status = "ranked";
      }
      writeRankingArtifact(projectId, pending.artifact_id, data);
    }
    return { status: "replaced", result, product_id: productId };
  } catch (e) {
    if (e instanceof VersionMismatchError) return { status: "stale_version", message: e.message };
    throw e;
  }
}
