import type { Box, Category } from "../../domain/types";

export type RoomSpace = { width_mm: number; length_mm: number; height_mm?: number | null };

export type RoomItem = {
  id: string;
  category: Category;
  box: Box;
  placement: { x_mm: number; y_mm: number; rotation_deg: number };
  imageUrl: string | null;
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
