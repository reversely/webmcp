import type { Box, Kind } from "../types";

/** PRD demo product sizes, width × depth × height in millimetres, one per rendering kind. */
export const DEMO_BOXES: Array<[Kind, Box]> = [
  ["seating", { width_mm: 2134, depth_mm: 914, height_mm: 838 }],
  ["table", { width_mm: 1220, depth_mm: 610, height_mm: 450 }],
  ["storage", { width_mm: 1200, depth_mm: 400, height_mm: 900 }],
  ["soft_floor", { width_mm: 2438, depth_mm: 3048, height_mm: 10 }],
  ["bed", { width_mm: 1600, depth_mm: 2000, height_mm: 600 }],
  ["lighting", { width_mm: 400, depth_mm: 400, height_mm: 1500 }],
  ["decor", { width_mm: 610, depth_mm: 610, height_mm: 430 }],
  ["other", { width_mm: 508, depth_mm: 508, height_mm: 610 }]
];
