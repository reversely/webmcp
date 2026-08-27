/**
 * Flat-colour fallback for a product whose image cannot be used as a texture: the image's average
 * colour when a canvas can read it, else a per-category default.
 */
import type { Category } from "../../domain/types";

export const CATEGORY_COLOURS: Record<Category, string> = {
  sofa: "#7a5c3e",
  coffee_table: "#9a7b55",
  ottoman: "#2f3e5c",
  rug: "#c9b8a0",
  side_table: "#8b6a45"
};

const ALPHA_FLOOR = 8;
const SAMPLE_SIZE = 32;

/** Mean colour of RGBA pixel data, ignoring transparent pixels; null when none are opaque. */
export function averagePixelColour(data: ArrayLike<number>): string | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < ALPHA_FLOOR) continue;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n++;
  }
  if (n === 0) return null;
  return toHex(r / n, g / n, b / n);
}

export type CanvasLike = {
  width: number;
  height: number;
  getContext(kind: "2d"): {
    drawImage(image: unknown, dx: number, dy: number, dw: number, dh: number): void;
    getImageData(x: number, y: number, w: number, h: number): { data: ArrayLike<number> };
  } | null;
};

/**
 * Downsamples an image onto a small canvas and averages it. Returns null when the canvas is
 * unavailable or tainted (a cross-origin image served without CORS headers throws on read).
 */
export function averageColourFromImage(
  image: unknown,
  createCanvas: () => CanvasLike = () => document.createElement("canvas")
): string | null {
  try {
    const canvas = createCanvas();
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    return averagePixelColour(ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data);
  } catch {
    return null;
  }
}

export function fallbackColour(average: string | null, category: Category): string {
  return average ?? CATEGORY_COLOURS[category];
}

function toHex(r: number, g: number, b: number): string {
  const channel = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}
