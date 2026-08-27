import { describe, expect, it } from "vitest";

import { KIND_COLOURS, averageColourFromImage, averagePixelColour, fallbackColour, productColourFromImage, productPixelColour, type CanvasLike } from "./colour";
import { GRID_STEP_M, cameraPose, gridSegments, itemRenderMode, itemTransform, roomMetres } from "./transform";

/** A 32 × 32 RGBA buffer: white studio background with a coloured block over the centre `inner` × `inner` pixels. */
function productImage(inner: number, rgb: [number, number, number], size = 32): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4);
  const start = (size - inner) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const centre = x >= start && x < start + inner && y >= start && y < start + inner;
      data.set(centre ? [...rgb, 255] : [255, 255, 255, 255], (y * size + x) * 4);
    }
  }
  return data;
}

const canvasReturning = (data: ArrayLike<number>): CanvasLike => ({
  width: 0,
  height: 0,
  getContext: () => ({ drawImage: () => {}, getImageData: () => ({ data }) })
});

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

  it("falls back to null on a tainted canvas and to the kind colour after that", () => {
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
    expect(fallbackColour(average, "decor")).toBe(KIND_COLOURS.decor);
    expect(fallbackColour("#123456", "decor")).toBe("#123456");
  });
});

describe("product colour sampler", () => {
  it("returns the centre colour of a product on a white background, not a white-tinted average", () => {
    const data = productImage(12, [40, 80, 120]);
    expect(productPixelColour(data, 32, 32)).toBe("#285078");
    expect(averagePixelColour(data)).not.toBe("#285078");
    expect(productColourFromImage({}, () => canvasReturning(data))).toBe("#285078");
  });

  it("takes the median inside the central crop, so an off-centre highlight does not tint it", () => {
    const data = productImage(20, [200, 30, 30]);
    // A bright stripe through the crop's top rows: a minority of the crop, so the median holds.
    for (let x = 8; x < 24; x++) data.set([30, 200, 30, 255], (8 * 32 + x) * 4);
    expect(productPixelColour(data, 32, 32)).toBe("#c81e1e");
  });

  it("ignores pixels outside the central 50% crop", () => {
    const data = productImage(32, [255, 255, 255]);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 4; x++) data.set([0, 0, 0, 255], (y * 32 + x) * 4);
    expect(productPixelColour(data, 32, 32)).toBeNull();
  });

  it("falls back to the average when the crop is all background, then to the kind colour", () => {
    const white = productImage(0, [0, 0, 0]);
    expect(productPixelColour(white, 32, 32)).toBeNull();
    expect(productColourFromImage({}, () => canvasReturning(white))).toBe("#ffffff");
    expect(fallbackColour(productColourFromImage({}, () => ({ width: 0, height: 0, getContext: () => null })), "soft_floor")).toBe(KIND_COLOURS.soft_floor);
  });
});

describe("itemRenderMode", () => {
  it("renders the GLB only when the job is ready and the URL is set", () => {
    expect(itemRenderMode({ modelStatus: "ready", glbUrl: "/models/abc.glb" })).toBe("glb");
    expect(itemRenderMode({ modelStatus: "ready", glbUrl: null })).toBe("proxy");
    for (const modelStatus of ["no_model", "queued", "generating", "proxy", "failed"] as const) {
      expect(itemRenderMode({ modelStatus, glbUrl: "/models/abc.glb" })).toBe("proxy");
    }
  });
});
