import type { DeliveryStatus, RankableCandidate, RankedCandidate, RankingOptions } from "./types";

interface VisualScore {
  passCount: number;
  meanConfidence: number;
}

function visualScore(candidate: RankableCandidate): VisualScore {
  const checks = candidate.visual?.checks ?? [];
  const passCount = checks.filter((check) => check.result === "pass").length;
  const meanConfidence =
    checks.length === 0 ? 0 : checks.reduce((sum, check) => sum + check.confidence, 0) / checks.length;
  return { passCount, meanConfidence };
}

/** A candidate with no delivery evidence yet ranks as `unknown`. */
function deliveryStatusOf(candidate: RankableCandidate): DeliveryStatus {
  return candidate.delivery_status ?? "unknown";
}

function why(candidate: RankableCandidate, options: RankingOptions): string[] {
  const visual = visualScore(candidate);
  const status = deliveryStatusOf(candidate);
  return [
    `visual: ${visual.passCount} pass, mean confidence ${visual.meanConfidence.toFixed(2)}`,
    `delivery: ${status} (${options.deliveryRank(status)})`,
    `price: ${candidate.price_cents}`
  ];
}

function compare(options: RankingOptions): (a: RankableCandidate, b: RankableCandidate) => number {
  return (a, b) => {
    const va = visualScore(a);
    const vb = visualScore(b);
    return (
      vb.passCount - va.passCount ||
      vb.meanConfidence - va.meanConfidence ||
      options.deliveryRank(deliveryStatusOf(b)) - options.deliveryRank(deliveryStatusOf(a)) ||
      a.price_cents - b.price_cents ||
      (options.secondary ? options.secondary(a, b) : 0)
    );
  };
}

/**
 * Orders survivors by visual compatibility, delivery confidence, price, then an optional
 * secondary preference. Candidates equal on every criterion keep their input order.
 */
export function rankSurvivors(candidates: RankableCandidate[], options: RankingOptions): RankedCandidate[] {
  return [...candidates]
    .sort(compare(options))
    .map((candidate, index) => ({ ...candidate, rank: index + 1, why: why(candidate, options) }));
}
