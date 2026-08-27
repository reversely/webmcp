import type { Box, Category, Product } from "../../domain/types";

export type RoomSpace = { width_mm: number; length_mm: number; height_mm?: number | null };

export type RoomItem = {
  id: string;
  category: Category;
  box: Box;
  placement: { x_mm: number; y_mm: number; rotation_deg: number };
  /** Source of the proxy's colour; never mapped onto the proxy as a texture. */
  imageUrl: string | null;
  /** Normalized GLB (bottom on Y=0, centred, bounds equal the box); rendered only when `modelStatus` is ready. */
  glbUrl: string | null;
  modelStatus: Product["model_status"];
  title: string;
};

export type CameraPreset = "top" | "corner";

export type Room3DProps = {
  space: RoomSpace;
  items: RoomItem[];
  selectedId?: string | null;
  /** Called with the clicked item's id, or null when the click lands on nothing. */
  onSelect?: (id: string | null) => void;
  className?: string;
};
