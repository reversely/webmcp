/**
 * GLB read/write and the PRD section 15.1 normalization pipeline, using @gltf-transform/core so
 * everything runs under Node without a DOM or WebGL.
 */
import { Document, NodeIO, getBounds, type Scene, type bbox, type vec3 } from "@gltf-transform/core";
import type { BufferGeometry } from "three";

import type { Box, Kind } from "../types";
import { METRES_PER_MM } from "./coordinates";
import { proxyForKind } from "./proxy";

export type Bounds = bbox;
export type RotationY = 0 | 90 | 180 | 270;

export type NormalizeReport = {
  originalBounds: Bounds;
  /** Per-axis scale in the target frame, applied after the rotation. */
  scale: vec3;
  rotationApplied: RotationY;
};

export const BOUNDS_TOLERANCE_M = 1 * METRES_PER_MM;

/**
 * Rebuilds a GLB so its bounds equal the product box: rotate about Y, scale each axis
 * independently, then centre on the origin in X and Z with the bottom on Y=0.
 *
 * Raises:
 *   Error: when the source mesh has zero extent along an axis the box needs, or holds no mesh.
 */
export async function normalizeGlb(
  input: Uint8Array,
  box: Box
): Promise<{ glb: Uint8Array; report: NormalizeReport }> {
  const doc = await new NodeIO().readBinary(input);
  const scene = defaultScene(doc);
  const originalBounds = getBounds(scene);
  const originalSize = sizeOf(originalBounds);
  if (!originalSize.every(Number.isFinite)) throw new Error("GLB holds no mesh to normalize");

  const rotation = chooseRotationY(originalSize, box);
  const rotatedSize = rotatedFootprint(originalSize, rotation);
  const target = targetSize(box);
  const scale = target.map((t, axis) => {
    if (rotatedSize[axis] === 0) throw new Error(`mesh has zero extent along axis ${axis}`);
    return t / rotatedSize[axis];
  }) as vec3;

  // glTF composes a node's TRS as T * R * S, which would scale before rotating. The non-uniform
  // scale belongs in the target frame, so rotation lives on an inner node and scale on its parent.
  const orientation = doc.createNode("orientation").setRotation(quaternionAboutY(rotation));
  for (const child of scene.listChildren()) {
    scene.removeChild(child);
    orientation.addChild(child);
  }
  const frame = doc.createNode("normalized").setScale(scale).addChild(orientation);
  scene.addChild(frame);

  const placed = getBounds(scene);
  frame.setTranslation([
    -(placed.min[0] + placed.max[0]) / 2,
    -placed.min[1],
    -(placed.min[2] + placed.max[2]) / 2
  ]);

  const glb = await new NodeIO().writeBinary(doc);
  return { glb, report: { originalBounds, scale, rotationApplied: rotation } };
}

/**
 * Picks the rotation about Y whose width:depth aspect is closest (in log ratio) to the box's.
 *
 * A bounding box cannot distinguish a mesh from the same mesh turned 180 degrees, so 0 and 180
 * share one aspect and 90 and 270 the other. This picks 0 or 90, and 0 on a tie; a wrong
 * front/back guess is corrected later by the user's `rotation_deg`.
 */
export function chooseRotationY(size: vec3, box: Box): RotationY {
  const [sx, , sz] = size;
  if (sx === 0 || sz === 0 || box.width_mm === 0 || box.depth_mm === 0) return 0;
  const target = Math.log(box.width_mm / box.depth_mm);
  const errorAt0 = Math.abs(Math.log(sx / sz) - target);
  const errorAt90 = Math.abs(Math.log(sz / sx) - target);
  return errorAt90 < errorAt0 ? 90 : 0;
}

/** Reloads a GLB and asserts its bounds are the box, centred in X and Z with the bottom on Y=0. */
export async function verifyBounds(glb: Uint8Array, box: Box): Promise<Bounds> {
  const doc = await new NodeIO().readBinary(glb);
  const bounds = getBounds(defaultScene(doc));
  const [w, h, d] = targetSize(box);
  const expected: Bounds = { min: [-w / 2, 0, -d / 2], max: [w / 2, h, d / 2] };
  for (const edge of ["min", "max"] as const) {
    for (let axis = 0; axis < 3; axis++) {
      const delta = Math.abs(bounds[edge][axis] - expected[edge][axis]);
      if (!(delta <= BOUNDS_TOLERANCE_M)) {
        throw new Error(
          `GLB ${edge}[${axis}] is ${bounds[edge][axis]} m, expected ${expected[edge][axis]} m (off by ${delta} m)`
        );
      }
    }
  }
  return bounds;
}

export async function proxyToGlb(kind: Kind, box: Box): Promise<Uint8Array> {
  const geometry = proxyForKind(kind, box);
  try {
    return await new NodeIO().writeBinary(geometryToDocument(geometry, `${kind}-proxy`));
  } finally {
    geometry.dispose();
  }
}

/** Wraps a three.js geometry in a single-mesh glTF document with a neutral material. */
export function geometryToDocument(geometry: BufferGeometry, name = "mesh"): Document {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const position = geometry.getAttribute("position");
  const primitive = doc
    .createPrimitive()
    .setAttribute(
      "POSITION",
      doc.createAccessor().setType("VEC3").setArray(Float32Array.from(position.array)).setBuffer(buffer)
    )
    .setMaterial(doc.createMaterial("proxy").setBaseColorFactor([0.8, 0.8, 0.8, 1]));
  const normal = geometry.getAttribute("normal");
  if (normal) {
    primitive.setAttribute(
      "NORMAL",
      doc.createAccessor().setType("VEC3").setArray(Float32Array.from(normal.array)).setBuffer(buffer)
    );
  }
  const index = geometry.getIndex();
  if (index) {
    primitive.setIndices(
      doc.createAccessor().setType("SCALAR").setArray(Uint32Array.from(index.array)).setBuffer(buffer)
    );
  }
  const node = doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(primitive));
  doc.createScene(name).addChild(node);
  return doc;
}

function defaultScene(doc: Document): Scene {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (!scene) throw new Error("GLB has no scene");
  return scene;
}

function sizeOf(bounds: Bounds): vec3 {
  return [bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]];
}

function targetSize(box: Box): vec3 {
  return [box.width_mm * METRES_PER_MM, box.height_mm * METRES_PER_MM, box.depth_mm * METRES_PER_MM];
}

/** Extents after a quarter turn: X and Z swap; a half turn leaves them as they were. */
function rotatedFootprint(size: vec3, rotation: RotationY): vec3 {
  return rotation === 90 || rotation === 270 ? [size[2], size[1], size[0]] : size;
}

function quaternionAboutY(degrees: RotationY): [number, number, number, number] {
  const half = (degrees * Math.PI) / 360;
  return [0, Math.sin(half), 0, Math.cos(half)];
}
