/**
 * Pure placement and room helpers for the R3F room. Everything is in three.js space (metres,
 * Y up) via the single mapping in src/domain/three/coordinates.ts.
 */
import { METRES_PER_MM, projectToThree } from "../../domain/three/coordinates";
import { MM_PER_FOOT } from "../../domain/types";

import type { CameraPreset, RoomItem, RoomSpace } from "./types";

export const DEFAULT_WALL_HEIGHT_MM = 2438;
export const GRID_STEP_M = MM_PER_FOOT * METRES_PER_MM;

export type Vec3 = [number, number, number];

export type ItemTransform = { position: Vec3; rotationY: number };

/** Places an item's proxy origin (bottom centre) on the floor and turns it about +Y. */
export function itemTransform(item: Pick<RoomItem, "placement">): ItemTransform {
  const { x_mm, y_mm, rotation_deg } = item.placement;
  const p = projectToThree(x_mm, y_mm, 0);
  return { position: [p.x, p.y, p.z], rotationY: (rotation_deg * Math.PI) / 180 };
}

export type RenderMode = "glb" | "proxy";

/** A generated model renders only once its job is ready and the GLB URL exists; every other state is the proxy (PRD 15.1). */
export function itemRenderMode(item: Pick<RoomItem, "glbUrl" | "modelStatus">): RenderMode {
  return item.modelStatus === "ready" && item.glbUrl ? "glb" : "proxy";
}

export type RoomMetres = { width: number; length: number; height: number };

export function roomMetres(space: RoomSpace): RoomMetres {
  return {
    width: space.width_mm * METRES_PER_MM,
    length: space.length_mm * METRES_PER_MM,
    height: (space.height_mm ?? DEFAULT_WALL_HEIGHT_MM) * METRES_PER_MM
  };
}

/** Line-segment endpoints (x, y, z triples) for a 1 ft grid over the floor, drawn just above it. */
export function gridSegments({ width, length }: RoomMetres, y = 0.002): Float32Array {
  const out: number[] = [];
  for (let x = 0; x <= width + 1e-9; x += GRID_STEP_M) out.push(x, y, 0, x, y, -length);
  for (let z = 0; z <= length + 1e-9; z += GRID_STEP_M) out.push(0, y, -z, width, y, -z);
  return Float32Array.from(out);
}

export type CameraPose = { position: Vec3; target: Vec3 };

/** Camera poses over the room: a plan view from above and a three-quarter view from the open corner. */
export function cameraPose(preset: CameraPreset, { width, length }: RoomMetres): CameraPose {
  const centre: Vec3 = [width / 2, 0, -length / 2];
  if (preset === "top") {
    // A hair off vertical keeps OrbitControls' up vector well defined.
    return { position: [width / 2, Math.max(width, length) * 1.25, -length / 2 + 0.001], target: centre };
  }
  return {
    position: [width * 1.55, Math.max(width, length) * 0.6, -length * 1.25],
    target: [width / 2, 0.3, -length * 0.35]
  };
}
