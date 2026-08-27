/**
 * Splits a category proxy into two material groups so the product image lands on the proxy's
 * largest faces (#44): group 0 is textured, group 1 is the flat fallback colour.
 *
 * The proxies in src/domain/three/proxy.ts arrive merged without groups, so faces are classified
 * by geometry alone: each triangle's geometric normal and centroid in the proxy's local frame
 * (metres, Y up, front facing -Z), against the proxy's own construction fractions.
 */
import { BufferAttribute, BufferGeometry, Vector3 } from "three";

import { METRES_PER_MM } from "../../domain/three/coordinates";
import type { Box, Category } from "../../domain/types";

export const TEXTURED_GROUP = 0;
export const PLAIN_GROUP = 1;

export type FaceRole = "textured" | "plain";

// Mirrors proxy.ts; the proxy exports no fractions, so they are restated here.
const SOFA_SEAT_HEIGHT_FRACTION = 0.45;
const TABLE_TOP_THICKNESS_M = 0.04;
const AXIS_ALIGNED = 0.7;
const EPSILON_M = 1e-4;

type Size = { w: number; h: number; d: number };

/** Which faces carry the image, per category, from a face's unit normal and centroid. */
export function classifyFace(category: Category, box: Box, normal: Vector3, centroid: Vector3): FaceRole {
  const size = toMetres(box);
  return isTextured(category, size, normal, centroid) ? "textured" : "plain";
}

function isTextured(category: Category, { h }: Size, n: Vector3, c: Vector3): boolean {
  switch (category) {
    case "sofa":
      // Seat top and the back's upward faces, plus every face turned to the front (-Z): the
      // seat front and the back cushion the sitter leans on.
      return n.y > AXIS_ALIGNED || n.z < -AXIS_ALIGNED || (n.y > 0.2 && c.y > h * SOFA_SEAT_HEIGHT_FRACTION - EPSILON_M);
    case "coffee_table":
    case "side_table": {
      // The top slab: its top face and its edges. Legs stay plain.
      const topThickness = Math.min(TABLE_TOP_THICKNESS_M, h / 4);
      return c.y > h - topThickness - EPSILON_M && n.y > -0.5;
    }
    case "ottoman":
      // The four sides including their rounded bevels; top and bottom stay plain.
      return Math.abs(n.y) < AXIS_ALIGNED;
    case "rug":
      return n.y > AXIS_ALIGNED;
  }
}

export type GroupedGeometry = { geometry: BufferGeometry; texturedTriangles: number; plainTriangles: number };

/**
 * Reorders the index so textured triangles come first, then adds the two groups. Mutates and
 * returns the same geometry, so the caller keeps ownership and disposal.
 */
export function withFaceGroups(category: Category, box: Box, geometry: BufferGeometry): GroupedGeometry {
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex() ?? sequentialIndex(position.count);
  const triangles = index.count / 3;
  const textured: number[] = [];
  const plain: number[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const normal = new Vector3();
  const centroid = new Vector3();
  for (let t = 0; t < triangles; t++) {
    const ia = index.getX(t * 3);
    const ib = index.getX(t * 3 + 1);
    const ic = index.getX(t * 3 + 2);
    a.fromBufferAttribute(position, ia);
    b.fromBufferAttribute(position, ib);
    c.fromBufferAttribute(position, ic);
    normal.subVectors(b, a).cross(c.clone().sub(a)).normalize();
    centroid.addVectors(a, b).add(c).divideScalar(3);
    const bucket = classifyFace(category, box, normal, centroid) === "textured" ? textured : plain;
    bucket.push(ia, ib, ic);
  }
  geometry.setIndex(new BufferAttribute(Uint32Array.from([...textured, ...plain]), 1));
  geometry.clearGroups();
  geometry.addGroup(0, textured.length, TEXTURED_GROUP);
  geometry.addGroup(textured.length, plain.length, PLAIN_GROUP);
  return { geometry, texturedTriangles: textured.length / 3, plainTriangles: plain.length / 3 };
}

function sequentialIndex(count: number): BufferAttribute {
  return new BufferAttribute(Uint32Array.from({ length: count }, (_, i) => i), 1);
}

function toMetres(box: Box): Size {
  return { w: box.width_mm * METRES_PER_MM, h: box.height_mm * METRES_PER_MM, d: box.depth_mm * METRES_PER_MM };
}
