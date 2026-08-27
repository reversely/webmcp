/**
 * Layout proposal (PRD 9 step 14) in project coordinates (PRD 12.1): the sofa backs onto the +y
 * wall, the coffee table sits in front of it, the ottoman beside the table, the rug under the
 * sofa front and the table, and the side table beside the sofa. Pure over boxes and a space so the
 * geometry check in tests needs no store.
 */
import { axisAlignedBounds, footprint, type FloorPlacement, type FloorSpace } from "../domain/geometry";
import type { Box, Category } from "../domain/types";

/** Distance from the sofa front to the coffee table's back edge. */
export const TABLE_GAP_MM = 900;
/** Gap between the table and the ottoman, and between the sofa and the side table. */
export const SIDE_GAP_MM = 300;
/** How far the rug runs under the sofa's front edge. */
export const RUG_UNDER_SOFA_MM = 200;
/**
 * Smallest rug that covers a coffee table and reaches the sofa front with the gaps above:
 * 5 x 7 ft, the smallest common area-rug size.
 */
export const MIN_RUG_MM = { short: 1524, long: 2134 };

export type Boxes = Partial<Record<Category, Box>>;
export type Layout = Partial<Record<Category, FloorPlacement>>;

/** A rug is large enough when its long side reaches the sofa front over the table and its short side spans a table. */
export function rugLargeEnough(rug: Box): boolean {
  const short = Math.min(rug.width_mm, rug.depth_mm);
  const long = Math.max(rug.width_mm, rug.depth_mm);
  return short >= MIN_RUG_MM.short && long >= MIN_RUG_MM.long;
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

export function proposeLayout(space: FloorSpace, boxes: Boxes): Layout {
  const layout: Layout = {};
  const centreX = Math.round(space.width_mm / 2);
  const sofa = boxes.sofa;
  // Sofa against the +y wall, rotated 180 so its front faces -y into the room.
  const sofaFrontY = sofa ? space.length_mm - sofa.depth_mm : space.length_mm;
  if (sofa) {
    layout.sofa = clampInside(sofa, { x_mm: centreX, y_mm: space.length_mm - Math.round(sofa.depth_mm / 2), rotation_deg: 180 }, space);
  }

  const table = boxes.coffee_table;
  if (table) {
    const y = sofaFrontY - TABLE_GAP_MM - Math.round(table.depth_mm / 2);
    layout.coffee_table = clampInside(table, { x_mm: centreX, y_mm: y, rotation_deg: 0 }, space);
  }

  const ottoman = boxes.ottoman;
  if (ottoman) {
    const anchor = layout.coffee_table;
    const x = anchor
      ? anchor.x_mm + Math.round(table!.width_mm / 2) + SIDE_GAP_MM + Math.round(ottoman.width_mm / 2)
      : centreX;
    const y = anchor ? anchor.y_mm : sofaFrontY - TABLE_GAP_MM - Math.round(ottoman.depth_mm / 2);
    layout.ottoman = clampInside(ottoman, { x_mm: x, y_mm: y, rotation_deg: 0 }, space);
  }

  const rug = boxes.rug;
  if (rug) {
    // The long side runs along y so the rug reaches from under the sofa front past the table.
    const rotated = rug.width_mm > rug.depth_mm;
    const depth = rotated ? rug.width_mm : rug.depth_mm;
    const topY = Math.min(space.length_mm, sofaFrontY + RUG_UNDER_SOFA_MM);
    layout.rug = clampInside(rug, { x_mm: centreX, y_mm: topY - Math.round(depth / 2), rotation_deg: rotated ? 90 : 0 }, space);
  }

  const side = boxes.side_table;
  if (side) {
    const x = sofa
      ? centreX + Math.round(sofa.width_mm / 2) + SIDE_GAP_MM + Math.round(side.width_mm / 2)
      : space.width_mm - Math.round(side.width_mm / 2);
    layout.side_table = clampInside(side, { x_mm: x, y_mm: space.length_mm - Math.round(side.depth_mm / 2), rotation_deg: 0 }, space);
  }
  return layout;
}
