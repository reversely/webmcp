/**
 * The room as the Room stage edits it: dimensions in millimetres plus door and window openings
 * along a wall, measured from the wall's origin end (PRD 12.1, PRD 20 stage 2).
 */
export type Wall = "bottom" | "top" | "left" | "right";
export type Opening = { wall: Wall; offset_mm: number; width_mm: number };
export type RoomEstimate = {
  name: string;
  width_mm: number;
  length_mm: number;
  height_mm: number | null;
  door: Opening | null;
  window: Opening | null;
};

export const DOOR_WIDTH_MM = 914;
export const WINDOW_WIDTH_MM = 1219;
/** The room before anything is known: no dimensions, no name; the board estimate or the person supplies them. */
export const EMPTY_ROOM: RoomEstimate = { name: "", width_mm: 0, length_mm: 0, height_mm: null, door: null, window: null };

/** Wall length along which an opening slides. */
export function wallLength(wall: Wall, width_mm: number, length_mm: number): number {
  return wall === "bottom" || wall === "top" ? width_mm : length_mm;
}
