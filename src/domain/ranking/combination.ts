import type { Category } from "../types";
import type { BudgetWindow, RankedCandidate, SelectionResult } from "./types";

/** Search depth per category; 8^4 combinations is cheap and the demo never needs deeper picks. */
const TOP_PER_CATEGORY = 8;

/** PRD 8.4: when nothing lands in the window the agent re-searches the coffee table. */
const GAP_CATEGORY: Category = "coffee_table";

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

function topPicks(rankedByCategory: Partial<Record<Category, RankedCandidate[]>>, categories: Category[]) {
  return categories.map((category) =>
    [...(rankedByCategory[category] ?? [])].sort((a, b) => a.rank - b.rank).slice(0, TOP_PER_CATEGORY)
  );
}

function suggestedRange(partialSubtotal: number, window: BudgetWindow): BudgetWindow {
  return {
    min_cents: Math.max(0, window.min_cents - partialSubtotal),
    max_cents: Math.max(0, window.max_cents - partialSubtotal)
  };
}

/**
 * Picks one ranked candidate per required category whose subtotal lies in `[min, max)`.
 *
 * Without a valid combination it reports the gap category and the price range a candidate there
 * would need so the best partial combination of the other categories lands in the window.
 */
export function selectCombination(
  rankedByCategory: Partial<Record<Category, RankedCandidate[]>>,
  required: Category[],
  window: BudgetWindow
): SelectionResult {
  const full = bestCombination(
    topPicks(rankedByCategory, required),
    (subtotal) => subtotal >= window.min_cents && subtotal < window.max_cents
  );
  if (full) {
    const selected: Partial<Record<Category, RankedCandidate>> = {};
    required.forEach((category, index) => {
      selected[category] = full.picks[index];
    });
    return { selected, subtotal_cents: full.subtotal };
  }

  const others = topPicks(rankedByCategory, required.filter((category) => category !== GAP_CATEGORY));
  // Prefer a partial that a gap-category price can still close; fall back to the best partial by rank.
  const partial = bestCombination(others, (subtotal) => subtotal < window.max_cents) ?? bestCombination(others, () => true);
  return {
    no_combination: true,
    gapCategory: GAP_CATEGORY,
    suggestedPriceRange: suggestedRange(partial?.subtotal ?? 0, window)
  };
}
