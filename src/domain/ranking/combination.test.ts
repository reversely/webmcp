import { describe, expect, it } from "vitest";
import { budgetWindow } from "./budget";
import { pivotItem, selectCombination } from "./combination";
import { candidate } from "./fixtures";
import type { RankedCandidate } from "./types";

/** Items in the board's own words; nothing here is an application vocabulary. */
const REQUIRED = ["deep couch", "round coffee table", "leather ottoman", "big rug"];
const WINDOW = budgetWindow(250000, 18900);

function ranked(category: string, prices: number[]): RankedCandidate[] {
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
        "deep couch": ranked("deep couch", [177200, 159700, 190600]),
        "round coffee table": ranked("round coffee table", [49900, 81200, 24000]),
        "leather ottoman": ranked("leather ottoman", [41000, 42000, 49100]),
        "big rug": ranked("big rug", [34300, 70100, 24400])
      },
      REQUIRED,
      WINDOW
    );
    expect(result).toMatchObject({ subtotal_cents: 249100 });
    if (!("selected" in result)) throw new Error("expected a selection");
    expect(Object.fromEntries(Object.entries(result.selected).map(([k, v]) => [k, v.id]))).toEqual({
      "deep couch": "deep couch-2",
      "round coffee table": "round coffee table-3",
      "leather ottoman": "leather ottoman-1",
      "big rug": "big rug-3"
    });
  });

  it("prefers the lowest rank sum, then the subtotal closest to the top of the window", () => {
    const result = selectCombination(
      {
        "deep couch": ranked("deep couch", [150000, 160000]),
        "round coffee table": ranked("round coffee table", [30000, 40000]),
        "leather ottoman": ranked("leather ottoman", [30000]),
        "big rug": ranked("big rug", [30000])
      },
      REQUIRED,
      WINDOW
    );
    // Only the rank-1 pair (240000) lands in the window; every other pair reaches 250000 or more.
    expect(result).toMatchObject({ subtotal_cents: 240000 });

    const tied = selectCombination(
      {
        "deep couch": ranked("deep couch", [130000, 145000]),
        "round coffee table": ranked("round coffee table", [40000, 46000]),
        "leather ottoman": ranked("leather ottoman", [30000]),
        "big rug": ranked("big rug", [30000])
      },
      REQUIRED,
      WINDOW
    );
    // couch-1 + table-1 = 230000 and couch-2 + table-2 = 251000 fall outside the window; the two
    // remaining pairs tie at rank sum 5, so the higher subtotal (245000) wins over 236000.
    if (!("selected" in tied)) throw new Error("expected a selection");
    expect(tied.subtotal_cents).toBe(245000);
    expect([tied.selected["deep couch"]?.id, tied.selected["round coffee table"]?.id]).toEqual(["deep couch-2", "round coffee table-1"]);
  });

  it("reports the pivot item's gap and the range that closes it", () => {
    const rankedByItem = {
      "deep couch": ranked("deep couch", [150000, 100000]),
      "round coffee table": ranked("round coffee table", [10000, 70000]),
      "leather ottoman": ranked("leather ottoman", [30000]),
      "big rug": ranked("big rug", [20000])
    };
    // The coffee table's prices spread widest (60000), so it is the pivot; the best partial by rank is
    // couch-1 + ottoman + rug = 200000, and the table must add [31100, 50000).
    expect(pivotItem(rankedByItem, REQUIRED)).toBe("round coffee table");
    expect(selectCombination(rankedByItem, REQUIRED, WINDOW)).toEqual({
      no_combination: true,
      gapCategory: "round coffee table",
      suggestedPriceRange: { min_cents: 31100, max_cents: 50000 }
    });
  });

  it("reports the gap on a required item with no candidates", () => {
    const rankedByItem = { "deep couch": ranked("deep couch", [200000]), "leather ottoman": ranked("leather ottoman", [20000]), "big rug": ranked("big rug", [15000]) };
    expect(pivotItem(rankedByItem, REQUIRED)).toBe("round coffee table");
    expect(selectCombination(rankedByItem, REQUIRED, WINDOW)).toMatchObject({ no_combination: true, gapCategory: "round coffee table", suggestedPriceRange: { min_cents: 0, max_cents: 15000 } });
  });
});
