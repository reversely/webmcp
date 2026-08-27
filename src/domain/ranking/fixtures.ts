/** Builders shared by the ranking tests; not part of the module's public surface. */
import type { DeliveryRankFn, DeliveryStatus, RankableCandidate, VisualEvaluation } from "./types";

const DELIVERY_RANKS: Record<DeliveryStatus, number> = { confirmed: 3, likely: 2, unknown: 1, fail: 0 };
export const deliveryRank: DeliveryRankFn = (status) => DELIVERY_RANKS[status];

export function visual(results: Array<[result: "pass" | "fail", confidence: number]>): VisualEvaluation {
  const checks = results.map(([result, confidence], index) => ({
    requirement: `check ${index + 1}`,
    result,
    confidence
  }));
  return { overall: checks.every((check) => check.result === "pass") ? "pass" : "fail", checks };
}

export function candidate(
  id: string,
  overrides: Partial<RankableCandidate> = {}
): RankableCandidate {
  return {
    id,
    category: "round coffee table",
    price_cents: 40000,
    delivery_status: "confirmed",
    visual: visual([["pass", 0.9]]),
    ...overrides
  };
}
