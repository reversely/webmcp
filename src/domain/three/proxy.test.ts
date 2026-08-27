import { Box3, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { projectToThree, threeToProject } from "./coordinates";
import { DEMO_BOXES } from "./demo-boxes";
import { proxyForKind } from "./proxy";

const TOLERANCE_M = 0.001;

describe("proxyForKind", () => {
  it.each(DEMO_BOXES)("%s proxy bounds equal its box, bottom on Y=0, centred in X and Z", (kind, box) => {
    const geometry = proxyForKind(kind, box);
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox as Box3;
    const size = bounds.getSize(new Vector3());
    expect(size.x).toBeCloseTo(box.width_mm / 1000, 3);
    expect(size.y).toBeCloseTo(box.height_mm / 1000, 3);
    expect(size.z).toBeCloseTo(box.depth_mm / 1000, 3);
    expect(Math.abs(bounds.min.y)).toBeLessThanOrEqual(TOLERANCE_M);
    expect(Math.abs(bounds.min.x + bounds.max.x)).toBeLessThanOrEqual(TOLERANCE_M);
    expect(Math.abs(bounds.min.z + bounds.max.z)).toBeLessThanOrEqual(TOLERANCE_M);
  });

  it("puts the seating back on +Z so the seat faces -Z", () => {
    const box = DEMO_BOXES[0][1];
    const position = proxyForKind("seating", box).getAttribute("position");
    let frontTop = 0;
    let backTop = 0;
    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i);
      if (position.getZ(i) < 0) frontTop = Math.max(frontTop, y);
      else backTop = Math.max(backTop, y);
    }
    expect(backTop).toBeCloseTo(box.height_mm / 1000, 3);
    expect(frontTop).toBeLessThan(box.height_mm / 1000 / 2);
  });

  it("gives a soft floor without a height the 10 mm default thickness", () => {
    const geometry = proxyForKind("soft_floor", { width_mm: 2438, depth_mm: 3048, height_mm: 0 });
    geometry.computeBoundingBox();
    expect((geometry.boundingBox as Box3).max.y).toBeCloseTo(0.01, 6);
  });
});

describe("coordinate mapping", () => {
  it("sends project +y (the front) to three.js -Z and z up to Y", () => {
    expect(projectToThree(1000, 2000, 3000)).toEqual({ x: 1, y: 3, z: -2 });
  });

  it("round-trips through three.js", () => {
    expect(threeToProject(1, 3, -2)).toEqual({ x_mm: 1000, y_mm: 2000, z_mm: 3000 });
  });
});
