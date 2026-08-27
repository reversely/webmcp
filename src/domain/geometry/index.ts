/**
 * Geometry engine for the living-room planner (docs/prd.md section 14).
 *
 * Works only in project coordinates (section 12.1): `x` along the room width, `y` along the room
 * length, integer millimetres from the origin corner. A placement's `x_mm`/`y_mm` is the centre of
 * the product's footprint, and `rotation_deg` rotates the footprint counter-clockwise about that
 * centre. A product's front faces +y in its local frame.
 */
import { itemKey, type Box, type Kind, type LayoutRule, type Placement, type Space } from "../types";

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

/** A placed item: `name` is the project's phrase for it (the BOM item's category) and `kind` its rendering kind. */
export type LayoutItem = { id: string; name: string; kind: Kind; box: Box; placement: FloorPlacement };

/** One evaluated rule. `pass` is null when the rule could not be evaluated (a text rule, or a name with no placed item). */
export type RuleResult = { rule: LayoutRule; pass: boolean | null; detail: string };

export type LayoutCheck = {
  inside: Record<string, boolean>;
  collisions: [string, string][];
  clearances: Record<string, number>;
  rules: RuleResult[];
};

/** What a layout check reports about one placed item, for the placements route's response. */
export type PlacementWarning = {
  bom_item_id: string;
  kind: "collision" | "outside_room";
  /** The other item of a collision. */
  with?: string;
  detail: string;
};

/** `against_wall`: the nearest room edge is at most this far from the item (PRD 14). */
export const WALL_TOLERANCE_MM = 50;
/** `beside` without a stated distance: the items are at most this far apart. */
export const DEFAULT_BESIDE_MM = 600;
/** `clear_around` without a stated distance: every other item keeps at least this much clearance. */
export const DEFAULT_CLEAR_MM = 900;
/** `facing`: the object's centre lies within this angle of the subject's front normal. */
const FACING_HALF_ANGLE_DEG = 45;

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

/** The unit vector the front edge faces after rotation: +y in the local frame. */
export function frontNormal(fp: Footprint): Point {
  const [right, left] = frontEdge(fp);
  const edgeMid = { x: (right.x + left.x) / 2, y: (right.y + left.y) / 2 };
  const length = Math.hypot(edgeMid.x - fp.centre.x, edgeMid.y - fp.centre.y) || 1;
  return { x: (edgeMid.x - fp.centre.x) / length, y: (edgeMid.y - fp.centre.y) / length };
}

/** Whole millimetres from the footprint to the nearest room edge; negative once a corner is outside. */
export function wallDistance(fp: Footprint, space: FloorSpace): number {
  const b = axisAlignedBounds(fp);
  return Math.round(Math.min(b.min_x, b.min_y, space.width_mm - b.max_x, space.length_mm - b.max_y));
}

/** Every corner of `inner` lies inside `outer` (a shared boundary counts as inside). */
export function contains(outer: Footprint, inner: Footprint): boolean {
  return inner.corners.every((c) => containsPoint(outer.corners, c));
}

/** How far `inner` reaches past `outer` along any edge normal, 0 when contained. */
function overhang(outer: Footprint, inner: Footprint): number {
  let worst = 0;
  for (const axis of edgeNormals(outer.corners)) {
    const length = Math.hypot(axis.x, axis.y);
    if (length === 0) continue;
    const unit = { x: axis.x / length, y: axis.y / length };
    const po = project(outer.corners, unit);
    const pi = project(inner.corners, unit);
    worst = Math.max(worst, pi.max - po.max, po.min - pi.min);
  }
  return Math.round(worst);
}

/** The English sentence for a rule, for the status row and the agent's report. */
export function ruleSentence(rule: LayoutRule): string {
  if (rule.relation === "text") return rule.text;
  const objects = rule.objects.length ? joinNames(rule.objects) : "";
  const at = rule.distance_mm !== undefined ? ` within ${rule.distance_mm} mm` : "";
  switch (rule.relation) {
    case "under":
      return `${rule.subject} under ${objects || "the other items"}`;
    case "on_top_of":
      return `${rule.subject} on top of ${objects || "an item"}`;
    case "beside":
      return `${rule.subject} beside ${objects || "an item"}${at}`;
    case "facing":
      return `${rule.subject} facing ${objects || "an item"}`;
    case "against_wall":
      return `${rule.subject} against a wall`;
    case "clear_around":
      return `${rule.distance_mm !== undefined ? `${rule.distance_mm} mm` : "space"} clear around ${rule.subject}`;
  }
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Evaluates one layout rule generically (PRD 14): `under` as containment of every object by the
 * subject, `on_top_of` as containment of the subject by its object, `beside` as edge clearance at
 * or below the distance, `against_wall` as edge distance to a room edge at or below 50 mm,
 * `facing` as the subject's front normal pointing at the object, `clear_around` as a clearance
 * ring. Names resolve through `itemKey`; a name with no footprint leaves the rule unevaluated.
 */
export function evaluateRelation(rule: LayoutRule, footprintsByName: Map<string, Footprint>, space: FloorSpace): RuleResult {
  if (rule.relation === "text") return { rule, pass: null, detail: "Kept as written; not a relation the geometry engine evaluates." };
  const find = (name: string) => footprintsByName.get(itemKey(name));
  const subject = find(rule.subject);
  if (!subject) return { rule, pass: null, detail: `${rule.subject} is not placed yet.` };
  const objects = rule.objects.map((name) => ({ name, fp: find(name) }));
  const missing = objects.filter((o) => !o.fp).map((o) => o.name);
  const placed = objects.filter((o): o is { name: string; fp: Footprint } => o.fp !== undefined);
  const needsObjects = rule.relation !== "against_wall" && rule.relation !== "clear_around";
  if (needsObjects && placed.length === 0) {
    return { rule, pass: null, detail: missing.length ? `${joinNames(missing)} ${missing.length === 1 ? "is" : "are"} not placed yet.` : "The rule names no item to relate to." };
  }
  const unplaced = missing.length ? ` ${joinNames(missing)} ${missing.length === 1 ? "is" : "are"} not placed and not counted.` : "";

  switch (rule.relation) {
    case "under": {
      const out = placed.filter((o) => !contains(subject, o.fp));
      if (out.length === 0) return { rule, pass: true, detail: `${rule.subject} covers ${joinNames(placed.map((o) => o.name))} completely.${unplaced}` };
      return { rule, pass: false, detail: `${joinNames(out.map((o) => `${o.name} (${overhang(subject, o.fp)} mm past the edge)`))} ${out.length === 1 ? "extends" : "extend"} beyond ${rule.subject}.${unplaced}` };
    }
    case "on_top_of": {
      const off = placed.filter((o) => !contains(o.fp, subject));
      if (off.length === 0) return { rule, pass: true, detail: `${rule.subject} sits within ${joinNames(placed.map((o) => o.name))}.${unplaced}` };
      return { rule, pass: false, detail: `${rule.subject} reaches ${joinNames(off.map((o) => `${overhang(o.fp, subject)} mm past ${o.name}`))}.${unplaced}` };
    }
    case "beside": {
      const limit = rule.distance_mm ?? DEFAULT_BESIDE_MM;
      const gaps = placed.map((o) => ({ name: o.name, gap: clearance(subject, o.fp) }));
      const far = gaps.filter((g) => g.gap > limit);
      if (far.length === 0) return { rule, pass: true, detail: `${joinNames(gaps.map((g) => `${g.gap} mm from ${g.name}`))} (limit ${limit} mm).${unplaced}` };
      return { rule, pass: false, detail: `${joinNames(far.map((g) => `${g.gap} mm from ${g.name}`))}, more than ${limit} mm.${unplaced}` };
    }
    case "facing": {
      const normal = frontNormal(subject);
      const away = placed.filter((o) => {
        const dx = o.fp.centre.x - subject.centre.x;
        const dy = o.fp.centre.y - subject.centre.y;
        const length = Math.hypot(dx, dy);
        if (length === 0) return false;
        const cos = (dx * normal.x + dy * normal.y) / length;
        return cos < Math.cos((FACING_HALF_ANGLE_DEG * Math.PI) / 180);
      });
      if (away.length === 0) return { rule, pass: true, detail: `${rule.subject} faces ${joinNames(placed.map((o) => o.name))}.${unplaced}` };
      return { rule, pass: false, detail: `${rule.subject} faces away from ${joinNames(away.map((o) => o.name))}.${unplaced}` };
    }
    case "against_wall": {
      const gap = wallDistance(subject, space);
      if (gap <= WALL_TOLERANCE_MM) return { rule, pass: true, detail: `${rule.subject} is ${Math.max(gap, 0)} mm from the nearest wall.` };
      return { rule, pass: false, detail: `${rule.subject} is ${gap} mm from the nearest wall, more than ${WALL_TOLERANCE_MM} mm.` };
    }
    case "clear_around": {
      const limit = rule.distance_mm ?? DEFAULT_CLEAR_MM;
      const close: string[] = [];
      for (const [key, fp] of footprintsByName) {
        if (key === itemKey(rule.subject)) continue;
        const gap = clearance(subject, fp);
        if (gap < limit) close.push(`${key} at ${gap} mm`);
      }
      if (close.length === 0) return { rule, pass: true, detail: `Nothing placed within ${limit} mm of ${rule.subject}.` };
      return { rule, pass: false, detail: `${joinNames(close)} ${close.length === 1 ? "is" : "are"} closer than ${limit} mm to ${rule.subject}.` };
    }
  }
}

/** Pairs an `under` or `on_top_of` rule declares stand on each other, so their overlap is intended. */
function stackedPairs(rules: LayoutRule[]): Set<string> {
  const pairs = new Set<string>();
  for (const rule of rules) {
    if (rule.relation !== "under" && rule.relation !== "on_top_of") continue;
    for (const object of rule.objects) {
      pairs.add(`${itemKey(rule.subject)}|${itemKey(object)}`);
      pairs.add(`${itemKey(object)}|${itemKey(rule.subject)}`);
    }
  }
  return pairs;
}

/**
 * Full layout check for the `check_geometry` tool. Clearances are keyed `"idA|idB"` in item order.
 * A soft-floor item (a rug) never collides: furniture standing on it is coverage. A pair that a
 * rule stacks (`under`, `on_top_of`) is not a collision either. Every rule is evaluated in order.
 */
export function checkLayout(space: FloorSpace, items: LayoutItem[], rules: LayoutRule[] = []): LayoutCheck {
  const footprints = new Map(items.map((item) => [item.id, footprint(item.box, item.placement)]));
  const inside: Record<string, boolean> = {};
  for (const [id, fp] of footprints) inside[id] = insideRoom(fp, space);

  const stacked = stackedPairs(rules);
  const collisions: [string, string][] = [];
  const clearances: Record<string, number> = {};
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      const fa = footprints.get(a.id)!;
      const fb = footprints.get(b.id)!;
      const intended = a.kind === "soft_floor" || b.kind === "soft_floor" || stacked.has(`${itemKey(a.name)}|${itemKey(b.name)}`);
      if (!intended && overlaps(fa, fb)) collisions.push([a.id, b.id]);
      clearances[`${a.id}|${b.id}`] = clearance(fa, fb);
    }
  }

  // The first placed item of a name stands for it in the rules.
  const byName = new Map<string, Footprint>();
  for (const item of items) if (!byName.has(itemKey(item.name))) byName.set(itemKey(item.name), footprints.get(item.id)!);
  return { inside, collisions, clearances, rules: rules.map((rule) => evaluateRelation(rule, byName, space)) };
}

/** The collisions and wall crossings `checkLayout` found for one item; empty when the item sits clear. */
export function placementWarnings(layout: LayoutCheck, bomItemId: string): PlacementWarning[] {
  const warnings: PlacementWarning[] = [];
  if (layout.inside[bomItemId] === false) {
    warnings.push({ bom_item_id: bomItemId, kind: "outside_room", detail: `${bomItemId} crosses a room wall.` });
  }
  for (const [a, b] of layout.collisions) {
    if (a !== bomItemId && b !== bomItemId) continue;
    const other = a === bomItemId ? b : a;
    warnings.push({ bom_item_id: bomItemId, kind: "collision", with: other, detail: `${bomItemId} overlaps ${other}.` });
  }
  return warnings;
}

/** Math.round yields -0 for tiny negatives such as cos(90 degrees); `+ 0` folds it back to 0. */
function roundMm(value: number): number {
  return Math.round(value) + 0;
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
