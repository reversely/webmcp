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
  overlaps,
  rugCoverage
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

describe("rugCoverage", () => {
  const rugFp = footprint(rug, { x_mm: 1829, y_mm: 2000, rotation_deg: 0 });
  const tableOnRug = footprint(table, { x_mm: 1829, y_mm: 2000, rotation_deg: 0 });
  const sofaFacingRug = footprint(sofa, { x_mm: 1829, y_mm: 1000, rotation_deg: 0 });

  it("passes when the table is on the rug and the sofa front reaches it", () => {
    expect(rugCoverage(rugFp, tableOnRug, sofaFacingRug)).toEqual({
      tableInside: true,
      sofaFrontOverlaps: true,
      pass: true
    });
  });

  it("fails on the table when a corner hangs off the rug", () => {
    const hanging = footprint(table, { x_mm: 1829, y_mm: 2600, rotation_deg: 0 });
    expect(rugCoverage(rugFp, hanging, sofaFacingRug)).toEqual({
      tableInside: false,
      sofaFrontOverlaps: true,
      pass: false
    });
  });

  it("fails on the sofa when its front edge stops short of the rug", () => {
    const short = footprint(sofa, { x_mm: 1829, y_mm: 700, rotation_deg: 0 });
    expect(rugCoverage(rugFp, tableOnRug, short)).toEqual({
      tableInside: true,
      sofaFrontOverlaps: false,
      pass: false
    });
  });

  it("fails on the sofa when its back edge, not its front, is on the rug", () => {
    const turnedAway = footprint(sofa, { x_mm: 1829, y_mm: 1000, rotation_deg: 180 });
    expect(rugCoverage(rugFp, tableOnRug, turnedAway).sofaFrontOverlaps).toBe(false);
  });

  it("counts a front edge lying exactly on the rug boundary as reaching it", () => {
    const flush = footprint(sofa, { x_mm: 1829, y_mm: 781, rotation_deg: 0 });
    expect(frontEdge(flush)[0].y).toBe(axisAlignedBounds(rugFp).min_y);
    expect(rugCoverage(rugFp, tableOnRug, flush).sofaFrontOverlaps).toBe(true);
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
  const items = [
    { id: "sofa", box: sofa, placement: { x_mm: 1829, y_mm: 457, rotation_deg: 0 } },
    { id: "rug", box: rug, placement: { x_mm: 1829, y_mm: 2000, rotation_deg: 0 } },
    { id: "table", box: table, placement: { x_mm: 1829, y_mm: 2000, rotation_deg: 0 } }
  ];

  it("reports containment, collisions, pairwise clearances, and rug coverage", () => {
    const result = checkLayout(room, items, "rug", "table", "sofa");
    expect(result.inside).toEqual({ sofa: true, rug: true, table: true });
    expect(result.collisions).toEqual([["rug", "table"]]);
    expect(result.clearances).toEqual({ "sofa|rug": 324, "sofa|table": 786, "rug|table": 0 });
    expect(result.rugCoverage).toEqual({ tableInside: true, sofaFrontOverlaps: false, pass: false });
  });

  it("omits rug coverage when no rug, table, and sofa ids are given", () => {
    expect(checkLayout(room, items).rugCoverage).toBeUndefined();
  });

  it("rejects an unknown id", () => {
    expect(() => checkLayout(room, items, "rug", "table", "lamp")).toThrow('no item with id "lamp"');
  });
});
