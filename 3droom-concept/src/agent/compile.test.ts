import { describe, expect, it } from "vitest";
import { ProjectSpec, compileSpec } from "./compile";

describe("ProjectSpec", () => {
  it("carries suggested colours separately from the swatch palette", () => {
    const spec = ProjectSpec.parse({
      room: { width_mm: 3658, length_mm: 5486 },
      room_name: "room",
      budget: { maximum: 2000, currency: "USD" },
      required_by: null,
      required_items: [{ name: "Coffee Table for 4", kind: "table" }],
      visual_direction: { base: [], accent: [] },
      suggested_colours: [{ hex: "#1f2f4f", from_text: "Dark blue" }],
      layout_requirements: []
    });
    expect(spec.suggested_colours[0].from_text).toBe("Dark blue");
  });
});

describe.skipIf(process.env.LIVE_AGENT !== "1")("compileSpec live", () => {
  it("keeps item qualifiers, splits lists, and turns colour notes into suggestions", async () => {
    const spec = await compileSpec(["Sofa, Coffee Table for 4, Rug", "12' x 18' room", "Budget of $2000", "Dark blue, grey white"], []);
    expect(spec).not.toBeNull();
    const names = spec!.required_items.map((i) => i.name.toLowerCase());
    expect(names).toContain("sofa");
    expect(names.some((n) => n.startsWith("coffee table for 4"))).toBe(true);
    expect(names).toContain("rug");
    expect(names.some((n) => /blue|grey|white/.test(n))).toBe(false);
    expect(spec!.suggested_colours.length).toBeGreaterThanOrEqual(2);
    expect(spec!.room).toEqual({ width_mm: 3658, length_mm: 5486 });
    expect(spec!.budget?.maximum).toBe(2000);
  }, 60_000);

  it("keeps the board's four items when a note refers back to the rug with 'one'", async () => {
    const spec = await compileSpec(
      ["12 × 18 living room", "big rug underneath everything", "$2500 max", "Need Sept 15", "Deep couch", "Round coffee table", "Leather ottoman", "would love a wool one if the budget allows"],
      []
    );
    expect(spec).not.toBeNull();
    const names = spec!.required_items.map((i) => i.name.toLowerCase());
    expect(names).toEqual(expect.arrayContaining(["big rug", "deep couch", "round coffee table", "leather ottoman"]));
    expect(names).toHaveLength(4);
  }, 60_000);
});
