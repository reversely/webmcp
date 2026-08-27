/**
 * Layout proposal (PRD 9 step 14) in project coordinates (PRD 12.1): one kind-based default, then a
 * small solver over the project's layout relations. The default backs the largest seating item (or
 * the largest item when there is no seating) onto the longest wall facing into the room and lays
 * everything else out in front of it, spaced by clearance; soft floors go under the group. Each
 * relation then moves its subject. Pure over boxes and a space, so the geometry check in tests
 * needs no store. No rule here names an item.
 */
import {
  axisAlignedBounds,
  contains,
  footprint,
  overlaps,
  type FloorPlacement,
  type FloorSpace,
  type Footprint
} from "../domain/geometry";
import { itemKey, type Box, type Kind, type LayoutRule } from "../domain/types";

/** Distance from the anchor's front to the first row of items in front of it. */
export const FRONT_GAP_MM = 900;
/** Gap between neighbours in a row, and between the anchor and an item placed beside it. */
export const SIDE_GAP_MM = 300;
/** Distance between rows when the first row is full. */
const ROW_GAP_MM = 600;

export type LayoutInput = { name: string; kind: Kind; box: Box };
export type Layout = Record<string, FloorPlacement>;

type Vec = { x: number; y: number };
type Frame = { normal: Vec; tangent: Vec };

const ROTATIONS = [0, 90, 180, 270] as const;

function area(box: Box): number {
  return box.width_mm * box.depth_mm;
}

/** Shifts a placement so its axis-aligned bounds stay inside the room. */
function clampInside(box: Box, placement: FloorPlacement, space: FloorSpace): FloorPlacement {
  const b = axisAlignedBounds(footprint(box, placement));
  let dx = 0;
  let dy = 0;
  if (b.min_x < 0) dx = -b.min_x;
  else if (b.max_x > space.width_mm) dx = space.width_mm - b.max_x;
  if (b.min_y < 0) dy = -b.min_y;
  else if (b.max_y > space.length_mm) dy = space.length_mm - b.max_y;
  return { ...placement, x_mm: placement.x_mm + dx, y_mm: placement.y_mm + dy };
}

/** Half extents of a box along x and y at a rotation that is a multiple of 90 degrees. */
function halfExtents(box: Box, rotation: number): Vec {
  const turned = rotation % 180 !== 0;
  return { x: (turned ? box.depth_mm : box.width_mm) / 2, y: (turned ? box.width_mm : box.depth_mm) / 2 };
}

/** The rotation whose front (+y local) faces `direction`, snapped to 90 degrees. */
function rotationFacing(direction: Vec): number {
  if (Math.abs(direction.x) >= Math.abs(direction.y)) return direction.x > 0 ? 270 : 90;
  return direction.y > 0 ? 0 : 180;
}

/**
 * The longest wall, as the frame an anchor placed against it uses: `normal` points into the room
 * and `tangent` runs along the wall. A room longer than wide has its long walls at x = 0 and
 * x = width; the anchor takes the x = width wall so the origin corner stays open.
 */
function longestWall(space: FloorSpace): Frame & { centre: Vec } {
  if (space.length_mm >= space.width_mm) {
    return { normal: { x: -1, y: 0 }, tangent: { x: 0, y: 1 }, centre: { x: space.width_mm, y: space.length_mm / 2 } };
  }
  return { normal: { x: 0, y: -1 }, tangent: { x: 1, y: 0 }, centre: { x: space.width_mm / 2, y: space.length_mm } };
}

function extentAlong(box: Box, rotation: number, axis: Vec): number {
  const h = halfExtents(box, rotation);
  return Math.abs(axis.x) * h.x * 2 + Math.abs(axis.y) * h.y * 2;
}

/** The first row placement, and the next rows when a row is full, in front of the anchor. */
function placeRows(items: LayoutInput[], anchor: { item: LayoutInput; placement: FloorPlacement }, frame: Frame, space: FloorSpace, layout: Layout): void {
  const anchorFront = extentAlong(anchor.item.box, anchor.placement.rotation_deg, frame.normal) / 2;
  const wallLength = Math.abs(frame.tangent.x) * space.width_mm + Math.abs(frame.tangent.y) * space.length_mm;
  let rowStart = anchorFront + FRONT_GAP_MM;
  let row: LayoutInput[] = [];
  let rowWidth = 0;
  const flush = () => {
    if (row.length === 0) return;
    const rowDepth = Math.max(...row.map((i) => extentAlong(i.box, 0, frame.normal)));
    let cursor = -rowWidth / 2;
    for (const item of row) {
      const width = extentAlong(item.box, 0, frame.tangent);
      const along = cursor + width / 2;
      const out = rowStart + rowDepth / 2;
      const centre = {
        x: anchor.placement.x_mm + frame.normal.x * out + frame.tangent.x * along,
        y: anchor.placement.y_mm + frame.normal.y * out + frame.tangent.y * along
      };
      layout[itemKey(item.name)] = clampInside(item.box, { x_mm: Math.round(centre.x), y_mm: Math.round(centre.y), rotation_deg: 0 }, space);
      cursor += width + SIDE_GAP_MM;
    }
    rowStart += rowDepth + ROW_GAP_MM;
    row = [];
    rowWidth = 0;
  };
  for (const item of items) {
    const width = extentAlong(item.box, 0, frame.tangent);
    if (row.length > 0 && rowWidth + SIDE_GAP_MM + width > wallLength) flush();
    rowWidth += (row.length > 0 ? SIDE_GAP_MM : 0) + width;
    row.push(item);
  }
  flush();
}

/** Centres a soft floor under the items placed so far, its long side along the room's long axis. */
function placeSoftFloor(item: LayoutInput, placed: Footprint[], space: FloorSpace): FloorPlacement {
  const bounds = placed.map(axisAlignedBounds);
  const centre = bounds.length
    ? { x: (Math.min(...bounds.map((b) => b.min_x)) + Math.max(...bounds.map((b) => b.max_x))) / 2, y: (Math.min(...bounds.map((b) => b.min_y)) + Math.max(...bounds.map((b) => b.max_y))) / 2 }
    : { x: space.width_mm / 2, y: space.length_mm / 2 };
  const longRoom = space.length_mm >= space.width_mm;
  const longBox = item.box.depth_mm >= item.box.width_mm;
  const rotation = longRoom === longBox ? 0 : 90;
  return clampInside(item.box, { x_mm: Math.round(centre.x), y_mm: Math.round(centre.y), rotation_deg: rotation }, space);
}

function footprintOf(items: Map<string, LayoutInput>, layout: Layout, key: string): Footprint | null {
  const item = items.get(key);
  const placement = layout[key];
  return item && placement ? footprint(item.box, placement) : null;
}

/** Whether a placement collides with any other placed hard item. */
function collides(items: Map<string, LayoutInput>, layout: Layout, key: string, candidate: FloorPlacement): boolean {
  const item = items.get(key)!;
  const fp = footprint(item.box, candidate);
  for (const [otherKey, other] of items) {
    if (otherKey === key || other.kind === "soft_floor" || !layout[otherKey]) continue;
    if (overlaps(fp, footprint(other.box, layout[otherKey]))) return true;
  }
  return false;
}

/** The union of the objects' axis-aligned bounds, or null when none is placed. */
function unionBounds(items: Map<string, LayoutInput>, layout: Layout, keys: string[]) {
  const fps = keys.map((k) => footprintOf(items, layout, k)).filter((fp): fp is Footprint => fp !== null);
  if (fps.length === 0) return null;
  const bs = fps.map(axisAlignedBounds);
  return { min_x: Math.min(...bs.map((b) => b.min_x)), min_y: Math.min(...bs.map((b) => b.min_y)), max_x: Math.max(...bs.map((b) => b.max_x)), max_y: Math.max(...bs.map((b) => b.max_y)), fps };
}

function applyAgainstWall(items: Map<string, LayoutInput>, layout: Layout, key: string, space: FloorSpace): void {
  const item = items.get(key)!;
  const walls: Frame[] = [
    { normal: { x: 0, y: -1 }, tangent: { x: 1, y: 0 } },
    { normal: { x: 0, y: 1 }, tangent: { x: 1, y: 0 } },
    { normal: { x: 1, y: 0 }, tangent: { x: 0, y: 1 } },
    { normal: { x: -1, y: 0 }, tangent: { x: 0, y: 1 } }
  ];
  const current = layout[key];
  // Walls in order of nearness to where the item is now, so the move is the smallest that works.
  const distanceTo = (w: Frame) => (w.normal.y === -1 ? space.length_mm - current.y_mm : w.normal.y === 1 ? current.y_mm : w.normal.x === 1 ? current.x_mm : space.width_mm - current.x_mm);
  walls.sort((a, b) => distanceTo(a) - distanceTo(b));
  for (const wall of walls) {
    const rotation = rotationFacing(wall.normal);
    const depth = extentAlong(item.box, rotation, wall.normal) / 2;
    const along = Math.abs(wall.tangent.x) * current.x_mm + Math.abs(wall.tangent.y) * current.y_mm;
    const back = wall.normal.y === -1 ? { x: along, y: space.length_mm } : wall.normal.y === 1 ? { x: along, y: 0 } : wall.normal.x === 1 ? { x: 0, y: along } : { x: space.width_mm, y: along };
    const candidate = clampInside(item.box, { x_mm: Math.round(back.x + wall.normal.x * depth), y_mm: Math.round(back.y + wall.normal.y * depth), rotation_deg: rotation }, space);
    if (!collides(items, layout, key, candidate)) {
      layout[key] = candidate;
      return;
    }
  }
}

function applyBeside(items: Map<string, LayoutInput>, layout: Layout, key: string, objects: string[], gap: number, space: FloorSpace): void {
  const item = items.get(key)!;
  const target = objects.map((o) => items.get(o) && layout[o] ? o : null).find((o): o is string => o !== null);
  if (!target) return;
  const other = items.get(target)!;
  const otherPlacement = layout[target];
  const oh = halfExtents(other.box, otherPlacement.rotation_deg);
  const rotation = layout[key]?.rotation_deg ?? 0;
  const h = halfExtents(item.box, rotation);
  const sides: Vec[] = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 }
  ];
  for (const side of sides) {
    const candidate: FloorPlacement = {
      x_mm: Math.round(otherPlacement.x_mm + side.x * (oh.x + gap + h.x)),
      y_mm: Math.round(otherPlacement.y_mm + side.y * (oh.y + gap + h.y)),
      rotation_deg: rotation
    };
    const inside = clampInside(item.box, candidate, space);
    if (inside.x_mm === candidate.x_mm && inside.y_mm === candidate.y_mm && !collides(items, layout, key, candidate)) {
      layout[key] = candidate;
      return;
    }
  }
}

function applyFacing(items: Map<string, LayoutInput>, layout: Layout, key: string, objects: string[]): void {
  const target = objects.find((o) => items.get(o) && layout[o]);
  const current = layout[key];
  if (!target || !current) return;
  const to = { x: layout[target].x_mm - current.x_mm, y: layout[target].y_mm - current.y_mm };
  if (to.x === 0 && to.y === 0) return;
  layout[key] = { ...current, rotation_deg: rotationFacing(to) };
}

function applyOnTopOf(items: Map<string, LayoutInput>, layout: Layout, key: string, objects: string[], space: FloorSpace): void {
  const target = objects.find((o) => items.get(o) && layout[o]);
  if (!target) return;
  const item = items.get(key)!;
  layout[key] = clampInside(item.box, { x_mm: layout[target].x_mm, y_mm: layout[target].y_mm, rotation_deg: layout[target].rotation_deg }, space);
}

/** Centres the subject under its objects, in the orientation that contains the most of them. */
function applyUnder(items: Map<string, LayoutInput>, layout: Layout, key: string, objects: string[], space: FloorSpace): void {
  const item = items.get(key)!;
  const union = unionBounds(items, layout, objects);
  if (!union) return;
  const centre = { x: Math.round((union.min_x + union.max_x) / 2), y: Math.round((union.min_y + union.max_y) / 2) };
  let best: FloorPlacement | null = null;
  let bestScore = -1;
  for (const rotation of ROTATIONS) {
    const candidate = clampInside(item.box, { x_mm: centre.x, y_mm: centre.y, rotation_deg: rotation }, space);
    const fp = footprint(item.box, candidate);
    const covered = union.fps.filter((o) => contains(fp, o)).length;
    if (covered > bestScore) {
      best = candidate;
      bestScore = covered;
    }
  }
  if (best) layout[key] = best;
}

function applyRule(rule: LayoutRule, items: Map<string, LayoutInput>, layout: Layout, space: FloorSpace): void {
  if (rule.relation === "text") return;
  const key = itemKey(rule.subject);
  if (!items.has(key) || !layout[key]) return;
  const objects = rule.objects.map(itemKey);
  switch (rule.relation) {
    case "against_wall":
      return applyAgainstWall(items, layout, key, space);
    case "beside":
      return applyBeside(items, layout, key, objects, rule.distance_mm ?? SIDE_GAP_MM, space);
    case "facing":
      return applyFacing(items, layout, key, objects);
    case "on_top_of":
      return applyOnTopOf(items, layout, key, objects, space);
    case "under":
      return applyUnder(items, layout, key, objects, space);
    case "clear_around":
      return;
  }
}

/** Rules apply in an order where each later one reads the positions the earlier ones settled. */
const RULE_ORDER: Record<Exclude<LayoutRule["relation"], "text">, number> = { against_wall: 0, facing: 1, beside: 2, on_top_of: 3, under: 4, clear_around: 5 };

/**
 * Proposes a placement per item, keyed by `itemKey(name)`. Items are matched to rules by name.
 * The result is deterministic for the same inputs.
 */
export function proposeLayout(space: FloorSpace, inputs: LayoutInput[], rules: LayoutRule[] = []): Layout {
  const items = new Map<string, LayoutInput>();
  for (const input of inputs) if (!items.has(itemKey(input.name))) items.set(itemKey(input.name), input);
  const layout: Layout = {};
  const hard = [...items.values()].filter((i) => i.kind !== "soft_floor").sort((a, b) => area(b.box) - area(a.box));
  const anchorItem = hard.find((i) => i.kind === "seating") ?? hard[0];
  if (anchorItem) {
    const wall = longestWall(space);
    const rotation = rotationFacing(wall.normal);
    const depth = extentAlong(anchorItem.box, rotation, wall.normal) / 2;
    const placement = clampInside(anchorItem.box, { x_mm: Math.round(wall.centre.x + wall.normal.x * depth), y_mm: Math.round(wall.centre.y + wall.normal.y * depth), rotation_deg: rotation }, space);
    layout[itemKey(anchorItem.name)] = placement;
    placeRows(hard.filter((i) => i !== anchorItem), { item: anchorItem, placement }, wall, space, layout);
  }
  for (const item of items.values()) {
    if (item.kind !== "soft_floor") continue;
    const placed = hard.map((h) => footprintOf(items, layout, itemKey(h.name))).filter((fp): fp is Footprint => fp !== null);
    layout[itemKey(item.name)] = placeSoftFloor(item, placed, space);
  }
  const ordered = rules.filter((r) => r.relation !== "text").sort((a, b) => RULE_ORDER[a.relation as keyof typeof RULE_ORDER] - RULE_ORDER[b.relation as keyof typeof RULE_ORDER]);
  for (const rule of ordered) applyRule(rule, items, layout, space);
  return layout;
}
