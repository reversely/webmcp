import { describe, expect, it } from "vitest";
import type { Box } from "../types";
import {
  axisAlignedBounds,
  candidateFits,
  checkLayout,
  clearance,
  distance,
  footprint,
  frontEdge,
  insideRoom,
  evaluateRelation,
  overlaps,
  placementWarnings,
  ruleSentence,
  wallDistance,
  type LayoutItem
} from "./index";

const room = { width_mm: 3658, length_mm: 5486 };
const sofa: Box = { width_mm: 2134, depth_mm: 914, height_mm: 838 };
const table: Box = { width_mm: 1200, depth_mm: 600, height_mm: 450 };
const rug: Box = { width_mm: 2438, depth_mm: 1524, height_mm: 10 };
const cube: Box = { width_mm: 1000, depth_mm: 1000, height_mm: 1000 };

describe("footprint", () => {
  it("places an unrotated sofa symmetrically about its centre with the front on +y", () => {
    const fp = footprint(sofa, { x_mm: 1829, y_mm: 457, rotation_deg: 0 });
    expect(axisAlignedBounds(fp)).toEqual({ min_x: 762, min_y: 0, max_x: 2896, max_y: 914 });
    expect(frontEdge(fp)).toEqual([
      { x: 2896, y: 914 },
      { x: 762, y: 914 }
    ]);
  });

  it("rotates 90 degrees counter-clockwise so the width runs along y and the front faces -x", () => {
    const fp = footprint(sofa, { x_mm: 457, y_mm: 2743, rotation_deg: 90 });
    expect(axisAlignedBounds(fp)).toEqual({ min_x: 0, min_y: 1676, max_x: 914, max_y: 3810 });
    expect(frontEdge(fp).every((p) => p.x === 0)).toBe(true);
  });

  it("rotates 180 degrees so the front faces -y", () => {
    const fp = footprint(sofa, { x_mm: 1829, y_mm: 5029, rotation_deg: 180 });
    expect(frontEdge(fp).every((p) => p.y === 4572)).toBe(true);
  });
});

describe("insideRoom", () => {
  it("accepts the sofa against the near wall at rotation 0 and rejects it once it crosses", () => {
    expect(insideRoom(footprint(sofa, { x_mm: 1829, y_mm: 457, rotation_deg: 0 }), room)).toBe(true);
    expect(insideRoom(footprint(sofa, { x_mm: 1829, y_mm: 400, rotation_deg: 0 }), room)).toBe(false);
  });

  it("accepts the sofa against the left wall at rotation 90 and rejects it once it crosses", () => {
    expect(insideRoom(footprint(sofa, { x_mm: 457, y_mm: 2743, rotation_deg: 90 }), room)).toBe(true);
    expect(insideRoom(footprint(sofa, { x_mm: 400, y_mm: 2743, rotation_deg: 90 }), room)).toBe(false);
  });

  it("rejects an unrotated sofa placed where its rotation-90 footprint would fit", () => {
    expect(insideRoom(footprint(sofa, { x_mm: 457, y_mm: 2743, rotation_deg: 0 }), room)).toBe(false);
  });
});

describe("overlaps and clearance", () => {
  const left = footprint(cube, { x_mm: 500, y_mm: 500, rotation_deg: 0 });

  it("treats boxes touching edge-to-edge as not overlapping with zero clearance", () => {
    const touching = footprint(cube, { x_mm: 1500, y_mm: 500, rotation_deg: 0 });
    expect(overlaps(left, touching)).toBe(false);
    expect(clearance(left, touching)).toBe(0);
  });

  it("measures a 100 mm gap between parallel edges", () => {
    const apart = footprint(cube, { x_mm: 1600, y_mm: 500, rotation_deg: 0 });
    expect(clearance(left, apart)).toBe(100);
    expect(clearance(apart, left)).toBe(100);
  });

  it("reports overlap for boxes that share area", () => {
    const shifted = footprint(cube, { x_mm: 1400, y_mm: 500, rotation_deg: 0 });
    expect(overlaps(left, shifted)).toBe(true);
    expect(clearance(left, shifted)).toBe(0);
  });

  it("clears a 45 degree diamond whose axis-aligned bounds intersect the box", () => {
    const origin = footprint(cube, { x_mm: 0, y_mm: 0, rotation_deg: 0 });
    const diamond = footprint(cube, { x_mm: 1000, y_mm: 1000, rotation_deg: 45 });
    const a = axisAlignedBounds(origin);
    const b = axisAlignedBounds(diamond);
    expect(a.max_x > b.min_x && a.max_y > b.min_y).toBe(true);
    expect(overlaps(origin, diamond)).toBe(false);
    expect(clearance(origin, diamond)).toBe(207);
  });

  it("detects overlap when the diamond's edge crosses the box corner", () => {
    const origin = footprint(cube, { x_mm: 0, y_mm: 0, rotation_deg: 0 });
    const diamond = footprint(cube, { x_mm: 800, y_mm: 800, rotation_deg: 45 });
    expect(overlaps(origin, diamond)).toBe(true);
    expect(clearance(origin, diamond)).toBe(0);
  });

  it("measures centre-to-centre distance", () => {
    expect(distance(left, footprint(cube, { x_mm: 800, y_mm: 900, rotation_deg: 0 }))).toBe(500);
  });
});

describe("evaluateRelation", () => {
  const rugFp = footprint(rug, { x_mm: 1829, y_mm: 2000, rotation_deg: 0 });
  const tableOnRug = footprint(table, { x_mm: 1829, y_mm: 2000, rotation_deg: 0 });
  const sofaFacingRug = footprint(sofa, { x_mm: 1829, y_mm: 1000, rotation_deg: 0 });
  const byName = new Map([
    ["big rug", rugFp],
    ["coffee table", tableOnRug],
    ["sofa", sofaFacingRug]
  ]);

  it("passes under when every object is inside the subject and fails with the overhang otherwise", () => {
    const rule = { relation: "under" as const, subject: "Big Rug", objects: ["coffee table"] };
    expect(evaluateRelation(rule, byName, room)).toMatchObject({ pass: true });
    const hanging = footprint(table, { x_mm: 1829, y_mm: 2600, rotation_deg: 0 });
    const result = evaluateRelation(rule, new Map([...byName, ["coffee table", hanging]]), room);
    expect(result.pass).toBe(false);
    expect(result.detail).toContain("138 mm past the edge");
  });

  it("fails under for a sofa whose back half is off the rug, and reports an unplaced object as null", () => {
    expect(evaluateRelation({ relation: "under", subject: "big rug", objects: ["sofa"] }, byName, room).pass).toBe(false);
    const result = evaluateRelation({ relation: "under", subject: "big rug", objects: ["lamp"] }, byName, room);
    expect(result.pass).toBeNull();
    expect(result.detail).toBe("lamp is not placed yet.");
  });

  it("evaluates on_top_of as the subject inside its object", () => {
    const vase = footprint({ width_mm: 200, depth_mm: 200, height_mm: 300 }, { x_mm: 1829, y_mm: 2000, rotation_deg: 0 });
    const withVase = new Map([...byName, ["vase", vase]]);
    expect(evaluateRelation({ relation: "on_top_of", subject: "vase", objects: ["coffee table"] }, withVase, room).pass).toBe(true);
    expect(evaluateRelation({ relation: "on_top_of", subject: "coffee table", objects: ["vase"] }, withVase, room).pass).toBe(false);
  });

  it("evaluates beside by edge clearance against the stated or default distance", () => {
    // Sofa front at y 1457, rug back at y 1238: they overlap, clearance 0.
    expect(evaluateRelation({ relation: "beside", subject: "sofa", objects: ["big rug"] }, byName, room).pass).toBe(true);
    const far = footprint(table, { x_mm: 1829, y_mm: 4500, rotation_deg: 0 });
    const spread = new Map([...byName, ["coffee table", far]]);
    expect(evaluateRelation({ relation: "beside", subject: "sofa", objects: ["coffee table"] }, spread, room)).toMatchObject({ pass: false });
    expect(evaluateRelation({ relation: "beside", subject: "sofa", objects: ["coffee table"], distance_mm: 3000 }, spread, room).pass).toBe(true);
  });

  it("evaluates facing by the front normal within 45 degrees", () => {
    expect(evaluateRelation({ relation: "facing", subject: "sofa", objects: ["coffee table"] }, byName, room).pass).toBe(true);
    const turned = new Map([...byName, ["sofa", footprint(sofa, { x_mm: 1829, y_mm: 1000, rotation_deg: 180 })]]);
    expect(evaluateRelation({ relation: "facing", subject: "sofa", objects: ["coffee table"] }, turned, room).pass).toBe(false);
  });

  it("evaluates against_wall within 50 mm of a room edge", () => {
    const flush = footprint(sofa, { x_mm: 1829, y_mm: 457, rotation_deg: 0 });
    expect(wallDistance(flush, room)).toBe(0);
    expect(evaluateRelation({ relation: "against_wall", subject: "sofa", objects: [] }, new Map([["sofa", flush]]), room).pass).toBe(true);
    expect(evaluateRelation({ relation: "against_wall", subject: "sofa", objects: [] }, byName, room)).toMatchObject({ pass: false });
  });

  it("evaluates clear_around as a clearance ring over every other placed item", () => {
    const lone = new Map([["sofa", sofaFacingRug], ["coffee table", footprint(table, { x_mm: 1829, y_mm: 3000, rotation_deg: 0 })]]);
    expect(evaluateRelation({ relation: "clear_around", subject: "sofa", objects: [], distance_mm: 1000 }, lone, room).pass).toBe(true);
    expect(evaluateRelation({ relation: "clear_around", subject: "sofa", objects: [] }, byName, room).pass).toBe(false);
  });

  it("leaves a text rule unevaluated and renders every relation as a sentence", () => {
    expect(evaluateRelation({ relation: "text", text: "keep the walkway open" }, byName, room).pass).toBeNull();
    expect(ruleSentence({ relation: "under", subject: "big rug", objects: ["sofa", "coffee table"] })).toBe("big rug under sofa and coffee table");
    expect(ruleSentence({ relation: "clear_around", subject: "desk", objects: [], distance_mm: 900 })).toBe("900 mm clear around desk");
    expect(ruleSentence({ relation: "text", text: "as written" })).toBe("as written");
  });
});

describe("candidateFits", () => {
  it("without a placement accepts a box that fits the room in either orientation", () => {
    expect(candidateFits(sofa, room, undefined, [])).toBe(true);
    expect(candidateFits({ width_mm: 5000, depth_mm: 3000, height_mm: 100 }, room, undefined, [])).toBe(true);
    expect(candidateFits({ width_mm: 6000, depth_mm: 900, height_mm: 100 }, room, undefined, [])).toBe(false);
  });

  it("with a placement requires the box inside the room and clear of the other footprints", () => {
    const placement = { x_mm: 1829, y_mm: 457, rotation_deg: 0 };
    const tableClear = footprint(table, { x_mm: 1829, y_mm: 2000, rotation_deg: 0 });
    const tableTooClose = footprint(table, { x_mm: 1829, y_mm: 1000, rotation_deg: 0 });
    expect(candidateFits(sofa, room, placement, [tableClear])).toBe(true);
    expect(candidateFits(sofa, room, placement, [tableClear, tableTooClose])).toBe(false);
    expect(candidateFits(sofa, room, { ...placement, y_mm: 400 }, [])).toBe(false);
  });
});

describe("checkLayout", () => {
  const items: LayoutItem[] = [
    { id: "sofa", name: "sofa", kind: "seating", box: sofa, placement: { x_mm: 1829, y_mm: 457, rotation_deg: 0 } },
    { id: "rug", name: "big rug", kind: "soft_floor", box: rug, placement: { x_mm: 1829, y_mm: 2000, rotation_deg: 0 } },
    { id: "table", name: "coffee table", kind: "table", box: table, placement: { x_mm: 1829, y_mm: 2000, rotation_deg: 0 } }
  ];

  it("reports containment, collisions, pairwise clearances, and one result per rule", () => {
    const result = checkLayout(room, items, [{ relation: "under", subject: "big rug", objects: ["sofa", "coffee table"] }]);
    expect(result.inside).toEqual({ sofa: true, rug: true, table: true });
    expect(result.collisions).toEqual([]);
    expect(result.clearances).toEqual({ "sofa|rug": 324, "sofa|table": 786, "rug|table": 0 });
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0].pass).toBe(false);
    expect(result.rules[0].detail).toMatch(/^sofa \(\d+ mm past the edge\) extends beyond big rug/);
  });

  it("returns no rule results without rules", () => {
    expect(checkLayout(room, items).rules).toEqual([]);
  });

  it("does not count furniture standing on a soft floor, or a pair a rule stacks, as a collision", () => {
    const hard = items.map((i) => ({ ...i, kind: "other" as const }));
    expect(checkLayout(room, hard).collisions).toContainEqual(["rug", "table"]);
    expect(checkLayout(room, hard, [{ relation: "under", subject: "big rug", objects: ["coffee table"] }]).collisions).toEqual([]);
    expect(checkLayout(room, items).collisions).toEqual([]);
  });
});

describe("placementWarnings", () => {
  const items: LayoutItem[] = [
    { id: "b1", name: "sofa", kind: "seating", box: sofa, placement: { x_mm: 1829, y_mm: 457, rotation_deg: 0 } },
    { id: "b2", name: "coffee table", kind: "table", box: table, placement: { x_mm: 1829, y_mm: 700, rotation_deg: 0 } },
    { id: "b3", name: "rug", kind: "soft_floor", box: rug, placement: { x_mm: 1829, y_mm: 1200, rotation_deg: 0 } },
    { id: "b4", name: "cube", kind: "other", box: cube, placement: { x_mm: 3400, y_mm: 3000, rotation_deg: 0 } }
  ];
  const layout = checkLayout(room, items);

  it("lists the collision from the placed item's side", () => {
    expect(placementWarnings(layout, "b2")).toEqual([
      { bom_item_id: "b2", kind: "collision", with: "b1", detail: "b2 overlaps b1." }
    ]);
    expect(placementWarnings(layout, "b1")).toEqual([
      { bom_item_id: "b1", kind: "collision", with: "b2", detail: "b1 overlaps b2." }
    ]);
  });

  it("reports a wall crossing", () => {
    expect(placementWarnings(layout, "b4")).toEqual([
      { bom_item_id: "b4", kind: "outside_room", detail: "b4 crosses a room wall." }
    ]);
  });

  it("is empty for a rug under furniture and for an unplaced id", () => {
    expect(placementWarnings(layout, "b3")).toEqual([]);
    expect(placementWarnings(layout, "b9")).toEqual([]);
  });
});
