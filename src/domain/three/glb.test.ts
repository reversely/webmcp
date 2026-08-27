import { NodeIO } from "@gltf-transform/core";
import { BoxGeometry } from "three";
import { describe, expect, it } from "vitest";

import type { Box } from "../types";
import { chooseRotationY, geometryToDocument, normalizeGlb, proxyToGlb, verifyBounds } from "./glb";
import { DEMO_BOXES } from "./demo-boxes";

const SOFA: Box = { width_mm: 2134, depth_mm: 914, height_mm: 838 };
const OFFSET: [number, number, number] = [3, 4, 5];

async function boxGlb(width: number, height: number, depth: number): Promise<Uint8Array> {
  const doc = geometryToDocument(new BoxGeometry(width, height, depth), "source");
  doc.getRoot().listNodes()[0].setTranslation(OFFSET);
  return new NodeIO().writeBinary(doc);
}

describe("proxyToGlb", () => {
  it.each(DEMO_BOXES)("%s proxy survives a GLB round trip with its bounds intact", async (category, box) => {
    await expect(verifyBounds(await proxyToGlb(category, box), box)).resolves.toBeDefined();
  });

  it("verifyBounds rejects a GLB whose bounds are not the box", async () => {
    const glb = await proxyToGlb("ottoman", DEMO_BOXES[2][1]);
    await expect(verifyBounds(glb, SOFA)).rejects.toThrow(/expected/);
  });
});

describe("normalizeGlb", () => {
  it("scales an offset 1 × 2 × 0.5 box to the sofa without rotating", async () => {
    const { glb, report } = await normalizeGlb(await boxGlb(1, 2, 0.5), SOFA);
    expect(report.rotationApplied).toBe(0);
    expect(report.scale[0]).toBeCloseTo(2.134 / 1, 6);
    expect(report.scale[1]).toBeCloseTo(0.838 / 2, 6);
    expect(report.scale[2]).toBeCloseTo(0.914 / 0.5, 6);
    expect(report.originalBounds.min.map((v) => Math.round(v * 1000) / 1000)).toEqual([2.5, 3, 4.75]);
    expect(report.originalBounds.max.map((v) => Math.round(v * 1000) / 1000)).toEqual([3.5, 5, 5.25]);
    await expect(verifyBounds(glb, SOFA)).resolves.toBeDefined();
  });

  it("turns a transposed box 90 degrees and scales in the rotated frame", async () => {
    const { glb, report } = await normalizeGlb(await boxGlb(0.5, 2, 1), SOFA);
    expect(report.rotationApplied).toBe(90);
    expect(report.scale[0]).toBeCloseTo(2.134 / 1, 6);
    expect(report.scale[1]).toBeCloseTo(0.838 / 2, 6);
    expect(report.scale[2]).toBeCloseTo(0.914 / 0.5, 6);
    await expect(verifyBounds(glb, SOFA)).resolves.toBeDefined();
  });

  it("rejects a mesh that is flat along an axis the box needs", async () => {
    await expect(normalizeGlb(await boxGlb(1, 0, 0.5), SOFA)).rejects.toThrow(/zero extent/);
  });
});

describe("chooseRotationY", () => {
  it("keeps 0 on a square footprint and a square box", () => {
    expect(chooseRotationY([1, 1, 1], { width_mm: 610, depth_mm: 610, height_mm: 430 })).toBe(0);
  });

  it("keeps 0 when either footprint extent is zero", () => {
    expect(chooseRotationY([0, 1, 1], SOFA)).toBe(0);
  });
});
