import { describe, expect, it } from "vitest";
import { candidate, deliveryRank, visual } from "./fixtures";
import { rankSurvivors } from "./rank";

describe("rankSurvivors", () => {
  it("orders by pass count, mean confidence, delivery, then price", () => {
    const ranked = rankSurvivors(
      [
        candidate("c1", { visual: visual([["pass", 0.8], ["pass", 0.8], ["fail", 0.8]]), price_cents: 50000 }),
        candidate("c2", { visual: visual([["pass", 0.7], ["pass", 0.7], ["pass", 0.7]]), delivery_status: "unknown", price_cents: 60000 }),
        candidate("c3", { visual: visual([["pass", 0.9], ["pass", 0.9], ["fail", 0.9]]), delivery_status: "unknown", price_cents: 70000 }),
        candidate("c4", { visual: visual([["pass", 0.8], ["pass", 0.8], ["fail", 0.8]]), price_cents: 40000 }),
        candidate("c5", { visual: visual([["pass", 0.8], ["pass", 0.8], ["fail", 0.8]]), delivery_status: "likely", price_cents: 10000 })
      ],
      { deliveryRank }
    );
    expect(ranked.map((c) => [c.rank, c.id])).toEqual([
      [1, "c2"],
      [2, "c3"],
      [3, "c4"],
      [4, "c1"],
      [5, "c5"]
    ]);
  });

  it("lists the ordered criteria values in why", () => {
    const [top] = rankSurvivors([candidate("c1", { visual: visual([["pass", 0.91], ["fail", 0.5]]) })], { deliveryRank });
    expect(top.why).toEqual(["visual: 1 pass, mean confidence 0.71", "delivery: confirmed (3)", "price: 40000"]);
  });

  it("breaks a full tie with the secondary comparator, else keeps input order", () => {
    const twins = [candidate("a"), candidate("b")];
    expect(rankSurvivors(twins, { deliveryRank }).map((c) => c.id)).toEqual(["a", "b"]);
    const preferB = rankSurvivors(twins, { deliveryRank, secondary: (x, y) => y.id.localeCompare(x.id) });
    expect(preferB.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("treats missing delivery and visual results as unknown and zero", () => {
    const ranked = rankSurvivors(
      [candidate("blank", { visual: null, delivery_status: null }), candidate("known", { delivery_status: "unknown" })],
      { deliveryRank }
    );
    expect(ranked.map((c) => c.id)).toEqual(["known", "blank"]);
    expect(ranked[1].why).toEqual(["visual: 0 pass, mean confidence 0.00", "delivery: unknown (1)", "price: 40000"]);
  });
});
