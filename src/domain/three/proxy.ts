/**
 * Dimensional proxy geometry for a product whose 3D generation failed (PRD section 15.1).
 *
 * Every proxy sits in three.js space: metres, Y up, bottom on Y=0, centred on the origin in X and
 * Z, front facing -Z (see coordinates.ts). Its bounding box equals the product box exactly.
 */
import { BoxGeometry, BufferGeometry, CylinderGeometry } from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import type { Box, Kind } from "../types";
import { METRES_PER_MM } from "./coordinates";

/** Thickness of a soft-floor proxy when the product box carries no height. */
export const SOFT_FLOOR_THICKNESS_MM = 10;

const EDGE_RADIUS_M = 0.04;
const TABLE_TOP_THICKNESS_M = 0.04;
const TABLE_LEG_RADIUS_M = 0.025;
const SEAT_HEIGHT_FRACTION = 0.45;
const BACK_DEPTH_FRACTION = 0.25;
const SHADE_HEIGHT_FRACTION = 0.3;
const STEM_RADIUS_M = 0.02;
const MATTRESS_FRACTION = 0.4;

type Size = { w: number; h: number; d: number };

/** A generic shape per rendering kind (PRD 20): every proxy fills the product box exactly. */
export function proxyForKind(kind: Kind, box: Box): BufferGeometry {
  const size = toMetres(box);
  switch (kind) {
    case "seating":
      return seatingProxy(size);
    case "table":
      return tableProxy(size);
    case "soft_floor":
      return softFloorProxy(size);
    case "bed":
      return bedProxy(size);
    case "lighting":
      return lightingProxy(size);
    case "storage":
      return new BoxGeometry(size.w, size.h, size.d).translate(0, size.h / 2, 0);
    case "decor":
    case "other":
      return roundedCuboid(size, EDGE_RADIUS_M);
  }
}

function toMetres(box: Box): Size {
  return {
    w: box.width_mm * METRES_PER_MM,
    h: box.height_mm * METRES_PER_MM,
    d: box.depth_mm * METRES_PER_MM
  };
}

/** Seat block over the full footprint plus a back block along the +Z edge (the back). */
function seatingProxy({ w, h, d }: Size): BufferGeometry {
  const seatHeight = h * SEAT_HEIGHT_FRACTION;
  const backDepth = d * BACK_DEPTH_FRACTION;
  const seat = new RoundedBoxGeometry(w, seatHeight, d, 2, EDGE_RADIUS_M).translate(0, seatHeight / 2, 0);
  const back = new RoundedBoxGeometry(w, h, backDepth, 2, EDGE_RADIUS_M).translate(0, h / 2, (d - backDepth) / 2);
  return merge([seat, back]);
}

/** A top slab with four cylindrical legs inset so the legs stay inside the footprint. */
function tableProxy({ w, h, d }: Size): BufferGeometry {
  const topThickness = Math.min(TABLE_TOP_THICKNESS_M, h / 4);
  const legHeight = h - topThickness;
  const legRadius = Math.min(TABLE_LEG_RADIUS_M, w / 8, d / 8);
  const top = new BoxGeometry(w, topThickness, d).translate(0, h - topThickness / 2, 0);
  const legs = [-1, 1].flatMap((sx) =>
    [-1, 1].map((sz) =>
      new CylinderGeometry(legRadius, legRadius, legHeight, 16).translate(
        sx * (w / 2 - legRadius),
        legHeight / 2,
        sz * (d / 2 - legRadius)
      )
    )
  );
  return merge([top, ...legs]);
}

function roundedCuboid({ w, h, d }: Size, radius: number): BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, 3, radius).translate(0, h / 2, 0);
}

function softFloorProxy({ w, h, d }: Size): BufferGeometry {
  const thickness = h > 0 ? h : SOFT_FLOOR_THICKNESS_MM * METRES_PER_MM;
  return new BoxGeometry(w, thickness, d).translate(0, thickness / 2, 0);
}

/** A low base with a rounded mattress block on top, the headboard along the +Z edge. */
function bedProxy({ w, h, d }: Size): BufferGeometry {
  const baseHeight = h * (1 - MATTRESS_FRACTION) * 0.6;
  const mattressHeight = h * MATTRESS_FRACTION;
  const headDepth = Math.min(d * 0.08, 0.1);
  // Every part is a rounded box: mergeGeometries needs one attribute layout across the parts.
  const base = new RoundedBoxGeometry(w, baseHeight, d, 1, Math.min(EDGE_RADIUS_M, baseHeight / 2)).translate(0, baseHeight / 2, 0);
  const mattress = new RoundedBoxGeometry(w * 0.96, mattressHeight, d - headDepth, 2, EDGE_RADIUS_M).translate(0, baseHeight + mattressHeight / 2, -headDepth / 2);
  const head = new RoundedBoxGeometry(w, h, headDepth, 1, Math.min(EDGE_RADIUS_M, headDepth / 2)).translate(0, h / 2, (d - headDepth) / 2);
  return merge([base, mattress, head]);
}

/** A base disc, a stem, and a shade block at the top. */
function lightingProxy({ w, h, d }: Size): BufferGeometry {
  const shadeHeight = h * SHADE_HEIGHT_FRACTION;
  const baseHeight = Math.min(h * 0.05, 0.03);
  const baseRadius = Math.min(w, d) / 2;
  const stemRadius = Math.min(STEM_RADIUS_M, baseRadius / 2);
  const base = new CylinderGeometry(baseRadius, baseRadius, baseHeight, 24).translate(0, baseHeight / 2, 0);
  const stem = new CylinderGeometry(stemRadius, stemRadius, h - shadeHeight - baseHeight, 12).translate(0, baseHeight + (h - shadeHeight - baseHeight) / 2, 0);
  const shade = new BoxGeometry(w, shadeHeight, d).translate(0, h - shadeHeight / 2, 0);
  return merge([base, stem, shade]);
}

function merge(parts: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts);
  if (!merged) throw new Error("proxy parts have mismatched attributes and cannot merge");
  for (const part of parts) part.dispose();
  return merged;
}
