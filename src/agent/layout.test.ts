import { describe, expect, it } from "vitest";
import { checkLayout, type LayoutItem } from "../domain/geometry";
import { DEMO_BOXES } from "../domain/three/demo-boxes";
import type { Box, Category } from "../domain/types";
import { proposeLayout, rugLargeEnough } from "./layout";

const SPACE = { width_mm: 3658, length_mm: 5486 };
const BOXES = Object.fromEntries(DEMO_BOXES) as Record<Category, Box>;

describe("proposeLayout", () => {
  it("places the demo boxes without collisions, inside the room, with rug coverage", () => {
    const layout = proposeLayout(SPACE, BOXES);
    const items: LayoutItem[] = (Object.keys(layout) as Category[]).map((category) => ({
      id: category,
      box: BOXES[category],
      placement: layout[category]!
    }));
    const check = checkLayout(SPACE, items, "rug", "coffee_table", "sofa");
    expect(check.collisions).toEqual([]);
    expect(Object.values(check.inside).every(Boolean)).toBe(true);
    expect(check.rugCoverage?.pass).toBe(true);
    expect(items).toHaveLength(5);
  });

  it("backs the sofa onto the +y wall facing into the room with the table 900 mm in front", () => {
    const layout = proposeLayout(SPACE, BOXES);
    expect(layout.sofa).toMatchObject({ x_mm: 1829, y_mm: SPACE.length_mm - 457, rotation_deg: 180 });
    const sofaFront = SPACE.length_mm - BOXES.sofa.depth_mm;
    expect(layout.coffee_table!.y_mm + BOXES.coffee_table.depth_mm / 2).toBe(sofaFront - 900);
  });

  it("turns a rug so its long side runs along the room length", () => {
    const layout = proposeLayout(SPACE, { rug: { width_mm: 3048, depth_mm: 2438, height_mm: 10 } });
    expect(layout.rug?.rotation_deg).toBe(90);
  });

  it("rejects a rug smaller than 5 x 7 ft", () => {
    expect(rugLargeEnough({ width_mm: 1200, depth_mm: 1800, height_mm: 10 })).toBe(false);
    expect(rugLargeEnough(BOXES.rug)).toBe(true);
  });
});
