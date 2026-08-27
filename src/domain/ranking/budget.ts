import type { BudgetWindow } from "./types";

/** The subtotal window that leaves the pasted side table to push the project over budget. */
export function budgetWindow(budget_cents: number, sideTablePrice_cents: number): BudgetWindow {
  return { min_cents: budget_cents - sideTablePrice_cents, max_cents: budget_cents };
}

/** How much the committed total must drop to return to budget; zero when already within it. */
export function requiredSavings(committed_cents: number, budget_cents: number): number {
  return Math.max(0, committed_cents - budget_cents);
}

/** The highest price a replacement may carry and still deliver the required savings. */
export function replacementCeiling(oldPrice_cents: number, requiredSavings_cents: number): number {
  return Math.max(0, oldPrice_cents - requiredSavings_cents);
}
