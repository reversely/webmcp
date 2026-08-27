import type { Category } from "../types";
import type { BudgetWindow, RankedByItem, RankedCandidate, SelectionResult } from "./types";

/** Search depth per item; 8^4 combinations is cheap and the demo never needs deeper picks. */
const TOP_PER_ITEM = 8;

/**
 * The item whose price the selection can move most (PRD 8.4's gap item): a required item with no
 * ranked candidates first, otherwise the one whose ranked prices spread widest, ties in required
 * order. The second search and the replacement floor both target it.
 */
export function pivotItem(rankedByItem: Partial<RankedByItem>, required: Category[]): Category {
  const empty = required.find((item) => (rankedByItem[item] ?? []).length === 0);
  if (empty !== undefined) return empty;
  let best = required[0];
  let bestSpread = -1;
  for (const item of required) {
    const prices = (rankedByItem[item] ?? []).map((row) => row.price_cents);
    const spread = Math.max(...prices) - Math.min(...prices);
    if (spread > bestSpread) {
      best = item;
      bestSpread = spread;
    }
  }
  return best;
}

interface Combination {
  picks: RankedCandidate[];
  subtotal: number;
  rankSum: number;
}

function* combinations(lists: RankedCandidate[][], depth = 0): Generator<RankedCandidate[]> {
  if (depth === lists.length) {
    yield [];
    return;
  }
  for (const head of lists[depth]) {
    for (const tail of combinations(lists, depth + 1)) yield [head, ...tail];
  }
}

function isBetter(candidate: Combination, incumbent: Combination | null): boolean {
  if (!incumbent) return true;
  return candidate.rankSum < incumbent.rankSum ||
    (candidate.rankSum === incumbent.rankSum && candidate.subtotal > incumbent.subtotal);
}

// Exhaustive over the bounded lists so the result depends only on the inputs, never on iteration luck:
// lowest rank sum wins, and among equals the subtotal closest to the window's top.
function bestCombination(lists: RankedCandidate[][], accepts: (subtotal: number) => boolean): Combination | null {
  let best: Combination | null = null;
  for (const picks of combinations(lists)) {
    const subtotal = picks.reduce((sum, pick) => sum + pick.price_cents, 0);
    if (!accepts(subtotal)) continue;
    const combination = { picks, subtotal, rankSum: picks.reduce((sum, pick) => sum + pick.rank, 0) };
    if (isBetter(combination, best)) best = combination;
  }
  return best;
}

function topPicks(rankedByItem: Partial<RankedByItem>, items: Category[]) {
  return items.map((item) => [...(rankedByItem[item] ?? [])].sort((a, b) => a.rank - b.rank).slice(0, TOP_PER_ITEM));
}

function suggestedRange(partialSubtotal: number, window: BudgetWindow): BudgetWindow {
  return {
    min_cents: Math.max(0, window.min_cents - partialSubtotal),
    max_cents: Math.max(0, window.max_cents - partialSubtotal)
  };
}

/**
 * Picks one ranked candidate per required item whose subtotal lies in `[min, max)`.
 *
 * Without a valid combination it reports the pivot item and the price range a candidate there
 * would need so the best partial combination of the other items lands in the window.
 */
export function selectCombination(rankedByItem: Partial<RankedByItem>, required: Category[], window: BudgetWindow): SelectionResult {
  const full = bestCombination(topPicks(rankedByItem, required), (subtotal) => subtotal >= window.min_cents && subtotal < window.max_cents);
  if (full) {
    const selected: Record<Category, RankedCandidate> = {};
    required.forEach((item, index) => {
      selected[item] = full.picks[index];
    });
    return { selected, subtotal_cents: full.subtotal };
  }

  const gap = pivotItem(rankedByItem, required);
  const others = topPicks(rankedByItem, required.filter((item) => item !== gap));
  // Prefer a partial that a pivot price can still close; fall back to the best partial by rank.
  const partial = bestCombination(others, (subtotal) => subtotal < window.max_cents) ?? bestCombination(others, () => true);
  return { no_combination: true, gapCategory: gap, suggestedPriceRange: suggestedRange(partial?.subtotal ?? 0, window) };
}
