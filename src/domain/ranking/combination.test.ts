import { describe, expect, it } from "vitest";
import type { Category } from "../types";
import { budgetWindow } from "./budget";
import { selectCombination } from "./combination";
import { candidate } from "./fixtures";
import type { RankedCandidate } from "./types";

const REQUIRED: Category[] = ["sofa", "coffee_table", "ottoman", "rug"];
const WINDOW = budgetWindow(250000, 18900);

function ranked(category: Category, prices: number[]): RankedCandidate[] {
  return prices.map((price_cents, index) => ({
    ...candidate(`${category}-${index + 1}`, { category, price_cents }),
    rank: index + 1,
    why: []
  }));
}

describe("selectCombination", () => {
  it("returns the single combination inside the window on the demo fixture", () => {
    // Prices chosen so exactly one of the 81 combinations sums into [231100, 250000).
    const result = selectCombination(
      {
        sofa: ranked("sofa", [177200, 159700, 190600]),
        coffee_table: ranked("coffee_table", [49900, 81200, 24000]),
        ottoman: ranked("ottoman", [41000, 42000, 49100]),
        rug: ranked("rug", [34300, 70100, 24400])
      },
      REQUIRED,
      WINDOW
    );
    expect(result).toMatchObject({ subtotal_cents: 249100 });
    if (!("selected" in result)) throw new Error("expected a selection");
    expect(Object.fromEntries(Object.entries(result.selected).map(([k, v]) => [k, v.id]))).toEqual({
      sofa: "sofa-2",
      coffee_table: "coffee_table-3",
      ottoman: "ottoman-1",
      rug: "rug-3"
    });
  });

  it("prefers the lowest rank sum, then the subtotal closest to the top of the window", () => {
    const result = selectCombination(
      {
        sofa: ranked("sofa", [150000, 160000]),
        coffee_table: ranked("coffee_table", [30000, 40000]),
        ottoman: ranked("ottoman", [30000]),
        rug: ranked("rug", [30000])
      },
      REQUIRED,
      WINDOW
    );
    // Only the rank-1 pair (240000) lands in the window; every other pair reaches 250000 or more.
    expect(result).toMatchObject({ subtotal_cents: 240000 });

    const tied = selectCombination(
      {
        sofa: ranked("sofa", [130000, 145000]),
        coffee_table: ranked("coffee_table", [40000, 46000]),
        ottoman: ranked("ottoman", [30000]),
        rug: ranked("rug", [30000])
      },
      REQUIRED,
      WINDOW
    );
    // sofa-1 + coffee-1 = 230000 and sofa-2 + coffee-2 = 251000 fall outside the window; the two
    // remaining pairs tie at rank sum 5, so the higher subtotal (245000) wins over 236000.
    if (!("selected" in tied)) throw new Error("expected a selection");
    expect(tied.subtotal_cents).toBe(245000);
    expect([tied.selected.sofa?.id, tied.selected.coffee_table?.id]).toEqual(["sofa-2", "coffee_table-1"]);
  });

  it("reports the coffee-table gap and the range that closes it", () => {
    const result = selectCombination(
      {
        sofa: ranked("sofa", [150000, 100000]),
        coffee_table: ranked("coffee_table", [10000, 60000]),
        ottoman: ranked("ottoman", [30000]),
        rug: ranked("rug", [20000])
      },
      REQUIRED,
      WINDOW
    );
    // Best partial by rank is sofa-1 + ottoman + rug = 200000; the coffee table must add [31100, 50000).
    expect(result).toEqual({
      no_combination: true,
      gapCategory: "coffee_table",
      suggestedPriceRange: { min_cents: 31100, max_cents: 50000 }
    });
  });

  it("reports the gap when a required category has no candidates", () => {
    const result = selectCombination(
      { sofa: ranked("sofa", [200000]), ottoman: ranked("ottoman", [20000]), rug: ranked("rug", [15000]) },
      REQUIRED,
      WINDOW
    );
    expect(result).toMatchObject({ no_combination: true, suggestedPriceRange: { min_cents: 0, max_cents: 15000 } });
  });
});
