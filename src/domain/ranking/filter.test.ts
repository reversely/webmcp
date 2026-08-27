import { describe, expect, it } from "vitest";
import { hardFilter } from "./filter";
import { candidate } from "./fixtures";
import type { FilterContext } from "./types";

const fits: FilterContext["fits"] = (c) => c.id !== "too-big";

describe("hardFilter initial mode", () => {
  const ctx: FilterContext = {
    mode: "initial",
    category: "coffee_table",
    budgetWindow: { min_cents: 231100, max_cents: 250000 },
    fits
  };

  it("eliminates one candidate per reason and keeps the rest", () => {
    const result = hardFilter(
      [
        candidate("ok"),
        candidate("rug", { category: "rug" }),
        candidate("too-big"),
        candidate("no-delivery", { delivery_status: "fail" }),
        candidate("too-pricey", { price_cents: 250001 }),
        candidate("at-max", { price_cents: 250000 })
      ],
      ctx
    );
    expect(result.survivors.map((c) => c.id)).toEqual(["ok", "at-max"]);
    expect(result.eliminated.map((e) => [e.candidate.id, e.reason])).toEqual([
      ["rug", "wrong_category"],
      ["too-big", "geometry_failure"],
      ["no-delivery", "delivery_fail"],
      ["too-pricey", "price_exceeds_window"]
    ]);
  });
});

describe("hardFilter replacement mode", () => {
  const ctx: FilterContext = {
    mode: "replacement",
    category: "coffee_table",
    requiredSavings_cents: 11800,
    oldPrice_cents: 49900,
    fits
  };

  it("eliminates one candidate per reason and keeps the rest", () => {
    const result = hardFilter(
      [
        candidate("cheaper", { price_cents: 30000 }),
        candidate("sofa", { category: "sofa", price_cents: 30000 }),
        candidate("too-big", { price_cents: 30000 }),
        candidate("no-delivery", { price_cents: 30000, delivery_status: "fail" }),
        candidate("saves-too-little", { price_cents: 38200 }),
        candidate("saves-exactly", { price_cents: 38100 })
      ],
      ctx
    );
    expect(result.survivors.map((c) => c.id)).toEqual(["cheaper", "saves-exactly"]);
    expect(result.eliminated.map((e) => [e.candidate.id, e.reason])).toEqual([
      ["sofa", "wrong_category"],
      ["too-big", "geometry_failure"],
      ["no-delivery", "delivery_fail"],
      ["saves-too-little", "insufficient_savings"]
    ]);
  });
});
