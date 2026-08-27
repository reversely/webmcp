/**
 * Dimensional proxy geometry for a product whose 3D generation failed (PRD section 15.1).
 *
 * Every proxy sits in three.js space: metres, Y up, bottom on Y=0, centred on the origin in X and
 * Z, front facing -Z (see coordinates.ts). Its bounding box equals the product box exactly.
 */
import { BoxGeometry, BufferGeometry, CylinderGeometry } from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import type { Box, Category } from "../types";
import { METRES_PER_MM } from "./coordinates";

/** Thickness of a rug proxy when the product box carries no height. */
export const RUG_THICKNESS_MM = 10;

const EDGE_RADIUS_M = 0.04;
const TABLE_TOP_THICKNESS_M = 0.04;
const TABLE_LEG_RADIUS_M = 0.025;
const SOFA_SEAT_HEIGHT_FRACTION = 0.45;
const SOFA_BACK_DEPTH_FRACTION = 0.25;

type Size = { w: number; h: number; d: number };

export function proxyForCategory(category: Category, box: Box): BufferGeometry {
  const size = toMetres(box);
  switch (category) {
    case "sofa":
      return sofaProxy(size);
    case "coffee_table":
    case "side_table":
      return tableProxy(size);
    case "ottoman":
      return roundedCuboid(size, EDGE_RADIUS_M);
    case "rug":
      return rugProxy(size);
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
function sofaProxy({ w, h, d }: Size): BufferGeometry {
  const seatHeight = h * SOFA_SEAT_HEIGHT_FRACTION;
  const backDepth = d * SOFA_BACK_DEPTH_FRACTION;
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

function rugProxy({ w, h, d }: Size): BufferGeometry {
  const thickness = h > 0 ? h : RUG_THICKNESS_MM * METRES_PER_MM;
  return new BoxGeometry(w, thickness, d).translate(0, thickness / 2, 0);
}

function merge(parts: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts);
  if (!merged) throw new Error("proxy parts have mismatched attributes and cannot merge");
  for (const part of parts) part.dispose();
  return merged;
}
