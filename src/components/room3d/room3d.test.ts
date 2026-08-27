import { Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { DEMO_BOXES } from "../../domain/three/demo-boxes";
import { proxyForCategory } from "../../domain/three/proxy";
import type { Box, Category } from "../../domain/types";
import { CATEGORY_COLOURS, averageColourFromImage, averagePixelColour, fallbackColour, type CanvasLike } from "./colour";
import { PLAIN_GROUP, TEXTURED_GROUP, classifyFace, withFaceGroups } from "./faces";
import { GRID_STEP_M, cameraPose, gridSegments, itemTransform, roomMetres } from "./transform";

const boxFor = (category: Category): Box => DEMO_BOXES.find(([c]) => c === category)![1];

describe("itemTransform", () => {
  it("maps project (x, y) to three (x, 0, -y) in metres and rotation_deg to radians about +Y", () => {
    const t = itemTransform({ placement: { x_mm: 1829, y_mm: 700, rotation_deg: 90 } });
    expect(t.position[0]).toBeCloseTo(1.829, 6);
    expect(t.position[1]).toBe(0);
    expect(t.position[2]).toBeCloseTo(-0.7, 6);
    expect(t.rotationY).toBeCloseTo(Math.PI / 2, 9);
  });
});

describe("room helpers", () => {
  const room = roomMetres({ width_mm: 3658, length_mm: 5486, height_mm: null });

  it("uses the 8 ft default wall height when the space carries none", () => {
    expect(room.height).toBeCloseTo(2.438, 6);
  });

  it("draws one grid line per foot on both axes, all inside the floor", () => {
    const segments = gridSegments(room);
    const lines = segments.length / 6;
    expect(lines).toBe(Math.floor(room.width / GRID_STEP_M) + 1 + Math.floor(room.length / GRID_STEP_M) + 1);
    for (let i = 0; i < segments.length; i += 3) {
      expect(segments[i]).toBeGreaterThanOrEqual(0);
      expect(segments[i]).toBeLessThanOrEqual(room.width + 1e-6);
      expect(segments[i + 2]).toBeLessThanOrEqual(0);
      expect(segments[i + 2]).toBeGreaterThanOrEqual(-room.length - 1e-6);
    }
  });

  it("puts the top preset above the room centre and the corner preset outside the open corner", () => {
    const top = cameraPose("top", room);
    expect(top.position[0]).toBeCloseTo(room.width / 2, 6);
    expect(top.position[1]).toBeGreaterThan(room.length);
    const corner = cameraPose("corner", room);
    expect(corner.position[0]).toBeGreaterThan(room.width);
    expect(corner.position[2]).toBeLessThan(-room.length);
  });
});

describe("average-colour fallback", () => {
  it("averages opaque pixels and skips transparent ones", () => {
    expect(averagePixelColour([255, 0, 0, 255, 0, 0, 255, 255, 9, 9, 9, 0])).toBe("#800080");
  });

  it("returns null when every pixel is transparent", () => {
    expect(averagePixelColour([1, 2, 3, 0])).toBeNull();
  });

  it("reads a stubbed image through a stubbed canvas", () => {
    const data = new Uint8ClampedArray(32 * 32 * 4);
    for (let i = 0; i < data.length; i += 4) data.set([10, 20, 30, 255], i);
    let drawn: unknown = null;
    const canvas: CanvasLike = {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: (image) => {
          drawn = image;
        },
        getImageData: () => ({ data })
      })
    };
    const image = { src: "stub" };
    expect(averageColourFromImage(image, () => canvas)).toBe("#0a141e");
    expect(drawn).toBe(image);
    expect(canvas.width).toBe(32);
  });

  it("falls back to null on a tainted canvas and to the category colour after that", () => {
    const tainted: CanvasLike = {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: () => {},
        getImageData: () => {
          throw new Error("SecurityError: tainted canvas");
        }
      })
    };
    const average = averageColourFromImage({}, () => tainted);
    expect(average).toBeNull();
    expect(fallbackColour(average, "ottoman")).toBe(CATEGORY_COLOURS.ottoman);
    expect(fallbackColour("#123456", "ottoman")).toBe("#123456");
  });
});

describe("texture-to-face mapping", () => {
  it.each(DEMO_BOXES)("%s groups cover every triangle, textured first", (category, box) => {
    const { geometry, texturedTriangles, plainTriangles } = withFaceGroups(category, box, proxyForCategory(category, box));
    const total = geometry.getIndex()!.count / 3;
    expect(texturedTriangles + plainTriangles).toBe(total);
    expect(texturedTriangles).toBeGreaterThan(0);
    expect(geometry.groups).toEqual([
      { start: 0, count: texturedTriangles * 3, materialIndex: TEXTURED_GROUP },
      { start: texturedTriangles * 3, count: plainTriangles * 3, materialIndex: PLAIN_GROUP }
    ]);
    geometry.dispose();
  });

  it("sofa: seat top and back front are textured, the sides and rear are plain", () => {
    const box = boxFor("sofa");
    const h = box.height_mm / 1000;
    const d = box.depth_mm / 1000;
    const up = new Vector3(0, 1, 0);
    expect(classifyFace("sofa", box, up, new Vector3(0, h * 0.45, -d * 0.2))).toBe("textured");
    expect(classifyFace("sofa", box, new Vector3(0, 0, -1), new Vector3(0, h * 0.8, d / 2 - d * 0.25))).toBe("textured");
    expect(classifyFace("sofa", box, new Vector3(1, 0, 0), new Vector3(box.width_mm / 2000, h * 0.2, 0))).toBe("plain");
    expect(classifyFace("sofa", box, new Vector3(0, 0, 1), new Vector3(0, h / 2, d / 2))).toBe("plain");
  });

  it("table: only the top slab is textured, never a leg", () => {
    for (const category of ["coffee_table", "side_table"] as const) {
      const box = boxFor(category);
      const { geometry, texturedTriangles } = withFaceGroups(category, box, proxyForCategory(category, box));
      const h = box.height_mm / 1000;
      const slabBottom = h - Math.min(0.04, h / 4) - 1e-4;
      const position = geometry.getAttribute("position");
      const index = geometry.getIndex()!;
      for (let i = 0; i < texturedTriangles * 3; i++) {
        expect(position.getY(index.getX(i))).toBeGreaterThanOrEqual(slabBottom);
      }
      const topFace = classifyFace(category, box, new Vector3(0, 1, 0), new Vector3(0, h, 0));
      expect(topFace).toBe("textured");
      expect(classifyFace(category, box, new Vector3(1, 0, 0), new Vector3(0.2, h / 2, 0))).toBe("plain");
      geometry.dispose();
    }
  });

  it("ottoman: the sides are textured and the top is plain", () => {
    const box = boxFor("ottoman");
    expect(classifyFace("ottoman", box, new Vector3(0, 0, -1), new Vector3(0, 0.2, -0.3))).toBe("textured");
    expect(classifyFace("ottoman", box, new Vector3(0, 1, 0), new Vector3(0, 0.43, 0))).toBe("plain");
  });

  it("rug: the upward plane is textured and the edges are plain", () => {
    const box = boxFor("rug");
    expect(classifyFace("rug", box, new Vector3(0, 1, 0), new Vector3(0, 0.01, 0))).toBe("textured");
    expect(classifyFace("rug", box, new Vector3(0, 0, -1), new Vector3(0, 0.005, -1.5))).toBe("plain");
    const { texturedTriangles } = withFaceGroups("rug", box, proxyForCategory("rug", box));
    expect(texturedTriangles).toBe(2);
  });
});
