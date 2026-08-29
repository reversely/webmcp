import type { EliminationReason, FilterContext, FilterResult, RankableCandidate } from "./types";

function priceReason(candidate: RankableCandidate, ctx: FilterContext): EliminationReason | null {
  if (ctx.mode === "initial") {
    return candidate.price_cents > ctx.budgetWindow.max_cents ? "price_exceeds_window" : null;
  }
  const savings = ctx.oldPrice_cents - candidate.price_cents;
  return savings < ctx.requiredSavings_cents ? "insufficient_savings" : null;
}

// Cheap checks run before the geometry test so `fits` is only called on candidates that can survive.
function eliminationReason(candidate: RankableCandidate, ctx: FilterContext): EliminationReason | null {
  if (candidate.category !== ctx.category) return "wrong_category";
  const byPrice = priceReason(candidate, ctx);
  if (byPrice) return byPrice;
  if (candidate.delivery_status === "fail") return "delivery_fail";
  if (!ctx.fits(candidate)) return "geometry_failure";
  return null;
}

/** Splits candidates into survivors and eliminations, each elimination carrying its first failing reason. */
export function hardFilter(candidates: RankableCandidate[], ctx: FilterContext): FilterResult {
  const result: FilterResult = { survivors: [], eliminated: [] };
  for (const candidate of candidates) {
    const reason = eliminationReason(candidate, ctx);
    if (reason) result.eliminated.push({ candidate, reason });
    else result.survivors.push(candidate);
  }
  return result;
}
