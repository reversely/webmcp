/**
 * Geometry engine for the living-room planner (docs/prd.md section 14).
 *
 * Works only in project coordinates (section 12.1): `x` along the room width, `y` along the room
 * length, integer millimetres from the origin corner. A placement's `x_mm`/`y_mm` is the centre of
 * the product's footprint, and `rotation_deg` rotates the footprint counter-clockwise about that
 * centre. A product's front faces +y in its local frame.
 */
import type { Box, Placement, Space } from "../types";

export type Point = { x: number; y: number };
export type FloorPlacement = Pick<Placement, "x_mm" | "y_mm" | "rotation_deg">;
export type FloorSpace = Pick<Space, "width_mm" | "length_mm">;

/**
 * A product's rotated rectangle on the floor plane. Corners run counter-clockwise from the
 * back-left corner: back-left, back-right, front-right, front-left, so the front edge (the +y face
 * in the local frame) joins corners 2 and 3.
 */
export type Footprint = { corners: [Point, Point, Point, Point]; centre: Point };
export type Bounds = { min_x: number; min_y: number; max_x: number; max_y: number };

export type RugCoverage = { tableInside: boolean; sofaFrontOverlaps: boolean; pass: boolean };

export type LayoutItem = { id: string; box: Box; placement: FloorPlacement };
export type LayoutCheck = {
  inside: Record<string, boolean>;
  collisions: [string, string][];
  clearances: Record<string, number>;
  rugCoverage?: RugCoverage;
};

/** Rotated corners round to whole millimetres so every later comparison is exact integer arithmetic. */
export function footprint(box: Box, placement: FloorPlacement): Footprint {
  const radians = (placement.rotation_deg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const halfWidth = box.width_mm / 2;
  const halfDepth = box.depth_mm / 2;
  const local: Point[] = [
    { x: -halfWidth, y: -halfDepth },
    { x: halfWidth, y: -halfDepth },
    { x: halfWidth, y: halfDepth },
    { x: -halfWidth, y: halfDepth }
  ];
  const corners = local.map((p) => ({
    x: roundMm(placement.x_mm + p.x * cos - p.y * sin),
    y: roundMm(placement.y_mm + p.x * sin + p.y * cos)
  })) as Footprint["corners"];
  return { corners, centre: { x: placement.x_mm, y: placement.y_mm } };
}

export function axisAlignedBounds(fp: Footprint): Bounds {
  const xs = fp.corners.map((c) => c.x);
  const ys = fp.corners.map((c) => c.y);
  return { min_x: Math.min(...xs), min_y: Math.min(...ys), max_x: Math.max(...xs), max_y: Math.max(...ys) };
}

/** The +y face after rotation, from the front-right corner to the front-left corner. */
export function frontEdge(fp: Footprint): [Point, Point] {
  return [fp.corners[2], fp.corners[3]];
}

export function insideRoom(fp: Footprint, space: FloorSpace): boolean {
  return fp.corners.every((c) => c.x >= 0 && c.x <= space.width_mm && c.y >= 0 && c.y <= space.length_mm);
}

/** Boxes that touch edge-to-edge do not overlap; a shared boundary is a zero clearance. */
export function overlaps(a: Footprint, b: Footprint): boolean {
  return !separated(a.corners, b.corners, true);
}

/** Minimum edge-to-edge distance in whole millimetres, 0 when the footprints overlap. */
export function clearance(a: Footprint, b: Footprint): number {
  if (overlaps(a, b)) return 0;
  let nearest = Infinity;
  for (const p of a.corners) nearest = Math.min(nearest, pointToPolygonDistance(p, b.corners));
  for (const p of b.corners) nearest = Math.min(nearest, pointToPolygonDistance(p, a.corners));
  return Math.round(nearest);
}

export function distance(a: Footprint, b: Footprint): number {
  return Math.round(Math.hypot(a.centre.x - b.centre.x, a.centre.y - b.centre.y));
}

/**
 * Demo rug policy: the table sits entirely on the rug and the sofa's front edge reaches the rug.
 * A front edge lying exactly on the rug's boundary counts as reaching it.
 */
export function rugCoverage(rug: Footprint, table: Footprint, sofa: Footprint): RugCoverage {
  const tableInside = table.corners.every((c) => containsPoint(rug.corners, c));
  const sofaFrontOverlaps = !separated(rug.corners, frontEdge(sofa), false);
  return { tableInside, sofaFrontOverlaps, pass: tableInside && sofaFrontOverlaps };
}

/**
 * Ranking geometry filter: without a placement the box fits the room in either orientation; with
 * one, the box at that placement is inside the room and overlaps none of `others`.
 */
export function candidateFits(
  box: Box,
  space: FloorSpace,
  placement: FloorPlacement | undefined,
  others: Footprint[]
): boolean {
  if (placement === undefined) {
    const upright = box.width_mm <= space.width_mm && box.depth_mm <= space.length_mm;
    const turned = box.depth_mm <= space.width_mm && box.width_mm <= space.length_mm;
    return upright || turned;
  }
  const fp = footprint(box, placement);
  return insideRoom(fp, space) && others.every((other) => !overlaps(fp, other));
}

/**
 * Full layout check for the `check_geometry` tool. Clearances are keyed `"idA|idB"` in item order.
 *
 * Raises:
 *   Error: when a rug, table, or sofa id names no item.
 */
export function checkLayout(
  space: FloorSpace,
  items: LayoutItem[],
  rugId?: string,
  tableId?: string,
  sofaId?: string
): LayoutCheck {
  const footprints = new Map(items.map((item) => [item.id, footprint(item.box, item.placement)]));
  const inside: Record<string, boolean> = {};
  for (const [id, fp] of footprints) inside[id] = insideRoom(fp, space);

  const collisions: [string, string][] = [];
  const clearances: Record<string, number> = {};
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i].id;
      const b = items[j].id;
      const fa = footprints.get(a)!;
      const fb = footprints.get(b)!;
      if (overlaps(fa, fb)) collisions.push([a, b]);
      clearances[`${a}|${b}`] = clearance(fa, fb);
    }
  }

  const result: LayoutCheck = { inside, collisions, clearances };
  if (rugId !== undefined && tableId !== undefined && sofaId !== undefined) {
    result.rugCoverage = rugCoverage(
      requireFootprint(footprints, rugId),
      requireFootprint(footprints, tableId),
      requireFootprint(footprints, sofaId)
    );
  }
  return result;
}

/** Math.round yields -0 for tiny negatives such as cos(90 degrees); `+ 0` folds it back to 0. */
function roundMm(value: number): number {
  return Math.round(value) + 0;
}

function requireFootprint(footprints: Map<string, Footprint>, id: string): Footprint {
  const fp = footprints.get(id);
  if (fp === undefined) throw new Error(`checkLayout: no item with id "${id}"`);
  return fp;
}

/**
 * Separating-axis test over the edge normals of both convex polygons. Integer corners make every
 * projection an exact integer, so the touching case (gap of exactly 0) is decided without epsilon.
 * A two-point polygon is a segment.
 */
function separated(a: Point[], b: Point[], touchingSeparates: boolean): boolean {
  for (const axis of [...edgeNormals(a), ...edgeNormals(b)]) {
    if (axis.x === 0 && axis.y === 0) continue;
    const pa = project(a, axis);
    const pb = project(b, axis);
    const gap = Math.max(pb.min - pa.max, pa.min - pb.max);
    if (touchingSeparates ? gap >= 0 : gap > 0) return true;
  }
  return false;
}

function edgeNormals(polygon: Point[]): Point[] {
  return polygon.map((start, i) => {
    const end = polygon[(i + 1) % polygon.length];
    return { x: -(end.y - start.y), y: end.x - start.x };
  });
}

function project(polygon: Point[], axis: Point): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const p of polygon) {
    const dot = p.x * axis.x + p.y * axis.y;
    min = Math.min(min, dot);
    max = Math.max(max, dot);
  }
  return { min, max };
}

/** Inclusive point-in-convex-polygon test; relies on the counter-clockwise corner order. */
function containsPoint(polygon: Point[], p: Point): boolean {
  return polygon.every((start, i) => {
    const end = polygon[(i + 1) % polygon.length];
    return (end.x - start.x) * (p.y - start.y) - (end.y - start.y) * (p.x - start.x) >= 0;
  });
}

function pointToPolygonDistance(p: Point, polygon: Point[]): number {
  let nearest = Infinity;
  polygon.forEach((start, i) => {
    nearest = Math.min(nearest, pointToSegmentDistance(p, start, polygon[(i + 1) % polygon.length]));
  });
  return nearest;
}

function pointToSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
