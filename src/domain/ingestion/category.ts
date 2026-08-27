import type { Category } from "../types";

/**
 * Title keywords per category, checked in this order so a compound name resolves to its own
 * category before a shorter keyword inside it ("coffee table" before "table", "sofa side
 * table" as a side table rather than a sofa).
 */
const KEYWORDS: [Category, RegExp][] = [
  ["coffee_table", /\bcoffee[\s-]?table\b/],
  ["side_table", /\b(?:bed)?side[\s-]?table\b|\bend[\s-]?table\b|\bnightstand\b/],
  ["ottoman", /\bottoman\b/],
  ["rug", /\brugs?\b/],
  ["sofa", /\bsofas?\b|\bcouch(?:es)?\b/]
];

/** Infers a category from a product title, or null when no keyword matches. */
export function inferCategory(title: string): Category | null {
  const lowered = title.toLowerCase();
  return KEYWORDS.find(([, pattern]) => pattern.test(lowered))?.[0] ?? null;
}
