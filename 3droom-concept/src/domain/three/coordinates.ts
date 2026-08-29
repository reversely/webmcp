/**
 * Mapping between project coordinates and three.js coordinates.
 *
 * Project space (PRD section 12.1): `x` along the room width, `y` along the room length, `z` up,
 * all in millimetres. A product's front faces +y in its local frame and `rotation_deg` turns it
 * counter-clockwise about z.
 *
 * three.js and glTF space: x right, y up, z towards the viewer, in metres.
 *
 * The mapping is the proper rotation (x, y, z_up) → (x, z_up, -y), so it preserves handedness and
 * no mesh gets mirrored. Consequences:
 * - a product's front (+y in project space) faces -Z in three.js; its back faces +Z;
 * - a counter-clockwise `rotation_deg` about project z is the same angle about three.js +Y.
 */

export type ThreeVector = { x: number; y: number; z: number };
export type ProjectVector = { x_mm: number; y_mm: number; z_mm: number };

export const METRES_PER_MM = 0.001;

export function projectToThree(x_mm: number, y_mm: number, z_mm: number): ThreeVector {
  return { x: x_mm * METRES_PER_MM, y: z_mm * METRES_PER_MM, z: -y_mm * METRES_PER_MM };
}

export function threeToProject(x: number, y: number, z: number): ProjectVector {
  return {
    x_mm: Math.round(x / METRES_PER_MM),
    y_mm: Math.round(-z / METRES_PER_MM),
    z_mm: Math.round(y / METRES_PER_MM)
  };
}
