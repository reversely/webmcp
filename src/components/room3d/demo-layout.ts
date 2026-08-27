/**
 * The five-item demo layout from scripts/build-3d-preview.ts (that script runs on import, so the
 * data is restated here). Room 12 ft × 18 ft; PRD demo product sizes.
 */
import type { RoomItem, RoomSpace } from "./types";

export const DEMO_SPACE: RoomSpace = { width_mm: 3658, length_mm: 5486, height_mm: null };

type DemoItem = Omit<RoomItem, "imageUrl" | "glbUrl" | "modelStatus">;

export const DEMO_ITEMS: DemoItem[] = [
  { id: "sofa", category: "sofa", title: "Sofa", box: { width_mm: 2134, depth_mm: 914, height_mm: 838 }, placement: { x_mm: 1829, y_mm: 700, rotation_deg: 0 } },
  { id: "table", category: "coffee_table", title: "Coffee table", box: { width_mm: 1220, depth_mm: 610, height_mm: 450 }, placement: { x_mm: 1829, y_mm: 1900, rotation_deg: 0 } },
  { id: "ottoman", category: "ottoman", title: "Ottoman", box: { width_mm: 610, depth_mm: 610, height_mm: 430 }, placement: { x_mm: 2900, y_mm: 1900, rotation_deg: 0 } },
  { id: "rug", category: "rug", title: "Rug", box: { width_mm: 2438, depth_mm: 3048, height_mm: 10 }, placement: { x_mm: 1829, y_mm: 1900, rotation_deg: 0 } },
  { id: "side", category: "side_table", title: "Side table", box: { width_mm: 508, depth_mm: 508, height_mm: 610 }, placement: { x_mm: 3200, y_mm: 700, rotation_deg: 0 } }
];

/** Pairs each demo item with an image URL for its proxy colour, cycling through the list; no URLs means category colours. */
export function demoItems(imageUrls: string[] = []): RoomItem[] {
  return DEMO_ITEMS.map((item, i) => ({
    ...item,
    imageUrl: imageUrls.length ? imageUrls[i % imageUrls.length] : null,
    glbUrl: null,
    modelStatus: "proxy"
  }));
}
