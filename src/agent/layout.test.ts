import { describe, expect, it } from "vitest";
import { checkLayout, footprint, frontNormal, wallDistance, type LayoutItem } from "../domain/geometry";
import type { Box, Kind } from "../domain/types";
import { FRONT_GAP_MM, proposeLayout, type LayoutInput } from "./layout";

const SPACE = { width_mm: 3658, length_mm: 5486 };

/** Items in the board's words; the kinds are what the agent infers for them. */
const ITEMS: LayoutInput[] = [
  { name: "deep couch", kind: "seating", box: { width_mm: 2134, depth_mm: 914, height_mm: 838 } },
  { name: "round coffee table", kind: "table", box: { width_mm: 1220, depth_mm: 610, height_mm: 450 } },
  { name: "leather ottoman", kind: "decor", box: { width_mm: 610, depth_mm: 610, height_mm: 430 } },
  { name: "big rug", kind: "soft_floor", box: { width_mm: 2438, depth_mm: 3048, height_mm: 10 } },
  { name: "end table", kind: "table", box: { width_mm: 508, depth_mm: 508, height_mm: 610 } }
];
const UNDER = { relation: "under" as const, subject: "big rug", objects: ["deep couch", "round coffee table"] };

function layoutItems(inputs: LayoutInput[], layout: ReturnType<typeof proposeLayout>): LayoutItem[] {
  return inputs.map((i) => ({ id: i.name, name: i.name, kind: i.kind, box: i.box, placement: layout[i.name.toLowerCase()] }));
}

describe("proposeLayout", () => {
  it("places every item inside the room without collisions and satisfies the under rule", () => {
    const layout = proposeLayout(SPACE, ITEMS, [UNDER]);
    const check = checkLayout(SPACE, layoutItems(ITEMS, layout), [UNDER]);
    expect(Object.keys(layout)).toHaveLength(5);
    expect(check.collisions).toEqual([]);
    expect(Object.values(check.inside).every(Boolean)).toBe(true);
    expect(check.rules[0]).toMatchObject({ pass: true });
  });

  it("backs the largest seating onto the longest wall facing into the room, with the next item in front of it", () => {
    const layout = proposeLayout(SPACE, ITEMS);
    const couch = layout["deep couch"];
    const fp = footprint(ITEMS[0].box, couch);
    expect(wallDistance(fp, SPACE)).toBe(0);
    expect(frontNormal(fp)).toEqual({ x: -1, y: 0 });
    // The room is longer than wide, so the long wall is x = width and the front gap runs along x.
    const table = layout["round coffee table"];
    expect(couch.x_mm - 457 - (table.x_mm + 610)).toBe(FRONT_GAP_MM);
  });

  it("anchors on the largest item when nothing is seating, and turns a soft floor to the room's long axis", () => {
    const boxes: LayoutInput[] = [
      { name: "standing desk", kind: "table", box: { width_mm: 1600, depth_mm: 800, height_mm: 1100 } },
      { name: "reading chair", kind: "seating", box: { width_mm: 800, depth_mm: 850, height_mm: 900 } },
      { name: "wide rug", kind: "soft_floor", box: { width_mm: 3048, depth_mm: 2438, height_mm: 10 } }
    ];
    const layout = proposeLayout(SPACE, boxes);
    expect(layout["reading chair"].rotation_deg).toBe(90);
    expect(layout["wide rug"].rotation_deg).toBe(90);
    const noSeating = proposeLayout(SPACE, [boxes[0], boxes[2]]);
    expect(wallDistance(footprint(boxes[0].box, noSeating["standing desk"]), SPACE)).toBe(0);
  });

  it("applies against_wall, beside, and facing to their subjects", () => {
    const rules = [
      { relation: "against_wall" as const, subject: "end table", objects: [] },
      { relation: "beside" as const, subject: "leather ottoman", objects: ["round coffee table"], distance_mm: 200 },
      { relation: "facing" as const, subject: "end table", objects: ["deep couch"] }
    ];
    const layout = proposeLayout(SPACE, ITEMS, rules);
    const items = layoutItems(ITEMS, layout);
    const check = checkLayout(SPACE, items, rules);
    expect(check.collisions).toEqual([]);
    expect(check.rules.map((r) => r.pass)).toEqual([true, true, true]);
  });

  it("returns an empty layout for no items and ignores rules that name nothing placed", () => {
    expect(proposeLayout(SPACE, [])).toEqual({});
    const layout = proposeLayout(SPACE, ITEMS.slice(0, 1), [{ relation: "under", subject: "big rug", objects: ["deep couch"] }]);
    expect(Object.keys(layout)).toEqual(["deep couch"]);
  });
});

export type { Box, Kind };
