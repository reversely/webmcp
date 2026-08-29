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

/** A BOM line as the savings plan sees it: its price and the cheapest price the project knows for its item. */
export interface SavingsLine {
  id: string;
  price_cents: number;
  floor_cents: number;
}

export interface SavingsShare {
  id: string;
  share_cents: number;
}

/** How far a line's price can drop before it reaches the cheapest price the project knows for its item. */
export function savingsCapacity(line: SavingsLine): number {
  return Math.max(0, line.price_cents - line.floor_cents);
}

/** Whether a line priced `price_cents` can absorb `required_cents` with a replacement priced at or above its floor. */
export function canAbsorb(line: SavingsLine, required_cents: number): boolean {
  const ceiling = replacementCeiling(line.price_cents, required_cents);
  return ceiling > 0 && ceiling >= line.floor_cents;
}

/**
 * The smallest set of lines whose combined capacity reaches `required_cents` (#64): the single
 * line with the largest price that can absorb it alone, else the pair with the largest combined
 * price, each pair member carrying a share proportional to its capacity. Null when no pair reaches it.
 */
export function savingsPlan(lines: SavingsLine[], required_cents: number): SavingsShare[] | null {
  if (required_cents <= 0) return [];
  const single = lines.filter((line) => canAbsorb(line, required_cents)).sort((a, b) => b.price_cents - a.price_cents)[0];
  if (single) return [{ id: single.id, share_cents: required_cents }];
  let best: [SavingsLine, SavingsLine] | null = null;
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      if (savingsCapacity(lines[i]) + savingsCapacity(lines[j]) < required_cents) continue;
      if (!best || lines[i].price_cents + lines[j].price_cents > best[0].price_cents + best[1].price_cents) best = [lines[i], lines[j]];
    }
  }
  if (!best) return null;
  const [a, b] = [...best].sort((x, y) => y.price_cents - x.price_cents);
  const capA = savingsCapacity(a);
  const shareA = Math.ceil((required_cents * capA) / (capA + savingsCapacity(b)));
  return [
    { id: a.id, share_cents: shareA },
    { id: b.id, share_cents: required_cents - shareA }
  ];
}
