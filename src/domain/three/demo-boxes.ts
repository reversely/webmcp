import type { Box, Category } from "../types";

/** PRD demo product sizes, width × depth × height in millimetres, one per category. */
export const DEMO_BOXES: Array<[Category, Box]> = [
  ["sofa", { width_mm: 2134, depth_mm: 914, height_mm: 838 }],
  ["coffee_table", { width_mm: 1220, depth_mm: 610, height_mm: 450 }],
  ["ottoman", { width_mm: 610, depth_mm: 610, height_mm: 430 }],
  ["rug", { width_mm: 2438, depth_mm: 3048, height_mm: 10 }],
  ["side_table", { width_mm: 508, depth_mm: 508, height_mm: 610 }]
];
