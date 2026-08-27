import { describe, expect, it } from "vitest";
import { budgetWindow, replacementCeiling, requiredSavings } from "./budget";

describe("budget arithmetic", () => {
  it("opens a window one side table below the budget", () => {
    expect(budgetWindow(250000, 18900)).toEqual({ min_cents: 231100, max_cents: 250000 });
  });

  it("requires the overage as savings and nothing when under budget", () => {
    expect(requiredSavings(261800, 250000)).toBe(11800);
    expect(requiredSavings(240000, 250000)).toBe(0);
  });

  it("caps the replacement at the old price less the required savings", () => {
    expect(replacementCeiling(49900, 11800)).toBe(38100);
    expect(replacementCeiling(5000, 11800)).toBe(0);
  });
});
