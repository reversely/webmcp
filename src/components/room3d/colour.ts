/**
 * The flat colour a proxy wears (PRD 15.1: a proxy reads as the product's colour, never as a
 * billboard of its photo). Preference order: the median colour of the image's central crop with
 * the background removed, the image's average colour, then a per-kind default.
 */
import type { Kind } from "../../domain/types";

export const KIND_COLOURS: Record<Kind, string> = {
  seating: "#7a5c3e",
  table: "#9a7b55",
  storage: "#8b6a45",
  soft_floor: "#c9b8a0",
  bed: "#b9a894",
  lighting: "#d9c8b0",
  decor: "#2f3e5c",
  other: "#9fa8b2"
};

const ALPHA_FLOOR = 8;
/** Every channel at or above this reads as studio background, not product. */
const NEAR_WHITE = 235;
/** The central crop covers this fraction of each axis, so 50% means the middle quarter of the area. */
const CROP_FRACTION = 0.5;
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

/**
 * Per-channel median of the pixels inside the central crop of a `width` × `height` RGBA buffer,
 * skipping transparent and near-white pixels. Null when nothing survives (a white product on a
 * white background), so the caller can fall back to the average.
 */
export function productPixelColour(data: ArrayLike<number>, width: number, height: number): string | null {
  const x0 = Math.floor((width * (1 - CROP_FRACTION)) / 2);
  const y0 = Math.floor((height * (1 - CROP_FRACTION)) / 2);
  const x1 = Math.ceil(width - x0);
  const y1 = Math.ceil(height - y0);
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      if (i + 3 >= data.length || data[i + 3] < ALPHA_FLOOR) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r >= NEAR_WHITE && g >= NEAR_WHITE && b >= NEAR_WHITE) continue;
      rs.push(r);
      gs.push(g);
      bs.push(b);
    }
  }
  if (rs.length === 0) return null;
  return toHex(median(rs), median(gs), median(bs));
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
 * Downsamples an image onto a small canvas and reads its pixels. Returns null when the canvas is
 * unavailable or tainted (a cross-origin image served without CORS headers throws on read).
 */
function samplePixels(image: unknown, createCanvas: () => CanvasLike): ArrayLike<number> | null {
  try {
    const canvas = createCanvas();
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    return ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
  } catch {
    return null;
  }
}

const defaultCanvas = (): CanvasLike => document.createElement("canvas");

/** Average colour of the whole image, or null when it cannot be read. */
export function averageColourFromImage(image: unknown, createCanvas: () => CanvasLike = defaultCanvas): string | null {
  const data = samplePixels(image, createCanvas);
  return data ? averagePixelColour(data) : null;
}

/** The product colour of an image: central-crop median with the background removed, else the average. */
export function productColourFromImage(image: unknown, createCanvas: () => CanvasLike = defaultCanvas): string | null {
  const data = samplePixels(image, createCanvas);
  if (!data) return null;
  return productPixelColour(data, SAMPLE_SIZE, SAMPLE_SIZE) ?? averagePixelColour(data);
}

export function fallbackColour(sampled: string | null, kind: Kind): string {
  return sampled ?? KIND_COLOURS[kind];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function toHex(r: number, g: number, b: number): string {
  const channel = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}
