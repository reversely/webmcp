import { describe, expect, it } from "vitest";
import { canAbsorb, replacementCeiling, requiredSavings, savingsPlan } from "./budget";
import { hardFilter } from "./filter";
import { candidate, deliveryRank, visual } from "./fixtures";
import { rankSurvivors } from "./rank";

describe("replacement flow (Scenes 11 to 13)", () => {
  it("derives the ceiling from the overage and ranks the survivors", () => {
    const sideTable = 18900;
    const oldCoffeeTable = 49900;
    const committed = 250000 + 11800;
    const savings = requiredSavings(committed, 250000);
    expect(savings).toBe(11800);
    expect(replacementCeiling(oldCoffeeTable, savings)).toBe(oldCoffeeTable - 11800);
    expect(sideTable).toBeGreaterThan(savings);

    const filtered = hardFilter(
      [
        candidate("walnut", { price_cents: 36000, visual: visual([["pass", 0.9], ["pass", 0.8]]) }),
        candidate("oak", { price_cents: 30000, visual: visual([["pass", 0.9], ["pass", 0.8]]), delivery_status: "likely" }),
        candidate("marble", { price_cents: 38100, visual: visual([["pass", 0.95], ["pass", 0.95]]) }),
        candidate("barely-cheaper", { price_cents: 45000 }),
        candidate("glass", { price_cents: 20000, delivery_status: "fail" })
      ],
      { mode: "replacement", category: "round coffee table", requiredSavings_cents: savings, oldPrice_cents: oldCoffeeTable, fits: () => true }
    );
    expect(filtered.eliminated.map((e) => [e.candidate.id, e.reason])).toEqual([
      ["barely-cheaper", "insufficient_savings"],
      ["glass", "delivery_fail"]
    ]);

    const ranked = rankSurvivors(filtered.survivors, { deliveryRank });
    expect(ranked.map((c) => [c.rank, c.id])).toEqual([
      [1, "marble"],
      [2, "walnut"],
      [3, "oak"]
    ]);
  });
});

describe("savingsPlan (#64)", () => {
  const lines = [
    { id: "couch", price_cents: 149900, floor_cents: 89900 },
    { id: "table", price_cents: 15999, floor_cents: 9900 },
    { id: "ottoman", price_cents: 24900, floor_cents: 14900 },
    { id: "rug", price_cents: 39900, floor_cents: 19900 }
  ];

  it("needs nothing when the budget is not over", () => {
    expect(savingsPlan(lines, 0)).toEqual([]);
  });

  it("says when a line cannot absorb the overage", () => {
    expect(canAbsorb(lines[1], 18000)).toBe(false);
    expect(canAbsorb(lines[1], 5000)).toBe(true);
    expect(canAbsorb({ id: "unknown-floor", price_cents: 10000, floor_cents: 0 }, 10000)).toBe(false);
  });

  it("picks the single line with the largest price that can absorb the overage", () => {
    expect(savingsPlan(lines, 18000)).toEqual([{ id: "couch", share_cents: 18000 }]);
    expect(savingsPlan(lines, 8000)).toEqual([{ id: "couch", share_cents: 8000 }]);
  });

  it("splits across the pair with the largest combined price when no single line can", () => {
    // Capacities: couch 600, table 60.99, ottoman 100, rug 200; 700 needs a pair.
    expect(savingsPlan(lines, 70000)).toEqual([
      { id: "couch", share_cents: 52500 },
      { id: "rug", share_cents: 17500 }
    ]);
  });

  it("returns null when no pair reaches the overage", () => {
    expect(savingsPlan(lines, 90000)).toBeNull();
  });
});
