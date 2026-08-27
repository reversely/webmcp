/**
 * Ranking inputs and outputs (PRD sections 8.4, 11, 13).
 *
 * Geometry and delivery evidence live in other modules; ranking receives their verdicts as
 * injected functions so it stays pure and testable on its own.
 */
import { z } from "zod";
import { Category, DeliveryStatus as DeliveryStatusSchema } from "../types";

export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>;

export const VisualCheck = z.object({
  requirement: z.string(),
  result: z.enum(["pass", "fail"]),
  confidence: z.number().min(0).max(1),
  explanation: z.string().optional()
});
export type VisualCheck = z.infer<typeof VisualCheck>;

/** The `evaluate_visual_fit` output shape from PRD section 11. */
export const VisualEvaluation = z.object({
  overall: z.enum(["pass", "fail"]),
  checks: z.array(VisualCheck)
});
export type VisualEvaluation = z.infer<typeof VisualEvaluation>;

/** A candidate joined with the product fields ranking reads. */
export interface RankableCandidate {
  id: string;
  category: Category;
  price_cents: number;
  delivery_status: DeliveryStatus | null;
  visual: VisualEvaluation | null;
}

export interface BudgetWindow {
  min_cents: number;
  max_cents: number;
}

export type FitsFn = (candidate: RankableCandidate) => boolean;
export type DeliveryRankFn = (status: DeliveryStatus) => number;

export type FilterMode =
  | { mode: "initial"; budgetWindow: BudgetWindow }
  | { mode: "replacement"; requiredSavings_cents: number; oldPrice_cents: number };

export type FilterContext = FilterMode & {
  category: Category;
  fits: FitsFn;
};

export type EliminationReason =
  | "wrong_category"
  | "geometry_failure"
  | "delivery_fail"
  | "price_exceeds_window"
  | "insufficient_savings";

export interface EliminatedCandidate {
  candidate: RankableCandidate;
  reason: EliminationReason;
}

export interface FilterResult {
  survivors: RankableCandidate[];
  eliminated: EliminatedCandidate[];
}

export interface RankedCandidate extends RankableCandidate {
  rank: number;
  /** One entry per ordered criterion, so an artifact can show why this candidate placed here. */
  why: string[];
}

export type Comparator = (a: RankableCandidate, b: RankableCandidate) => number;

export interface RankingOptions {
  deliveryRank: DeliveryRankFn;
  secondary?: Comparator;
}

export type SelectionResult =
  | { selected: Partial<Record<Category, RankedCandidate>>; subtotal_cents: number }
  | { no_combination: true; gapCategory: Category; suggestedPriceRange: BudgetWindow };
