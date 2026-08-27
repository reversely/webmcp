/**
 * Rule-based room estimate from a sentence such as "12 by 18 living room, door on the short wall"
 * (PRD 20, stage 2). Feet are the default unit; a trailing "m" reads as metres. Door and window
 * are openings along a wall, measured in millimetres from the wall's origin end (PRD 12.1).
 */
import { feetToMm } from "../../../../domain/types";

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
export const DEFAULT_ROOM: RoomEstimate = { name: "Living room", width_mm: 3658, length_mm: 5486, height_mm: null, door: null, window: null };

const FEET_UNIT = /(?:'|ft\b|feet|foot)/i;
const METRE_UNIT = /(?:m\b|metres?|meters?)/i;
const PAIR = /(\d+(?:\.\d+)?)\s*(m\b|metres?|meters?|'|ft\b|feet|foot)?\s*(?:x|×|by)\s*(\d+(?:\.\d+)?)\s*(m\b|metres?|meters?|'|ft\b|feet|foot)?/i;
const HEIGHT = /(\d+(?:\.\d+)?)\s*(m\b|metres?|meters?|'|ft\b|feet|foot)?\s*(?:ceiling|high|tall)|ceiling\s*(?:of|height|at|is)?\s*(\d+(?:\.\d+)?)\s*(m\b|metres?|meters?|'|ft\b|feet|foot)?/i;
const ROOM_NAMES = ["living room", "family room", "bedroom", "office", "den", "studio", "lounge", "dining room"];

function toMm(value: number, unit: string | undefined): number {
  if (unit && METRE_UNIT.test(unit) && !FEET_UNIT.test(unit)) return Math.round(value * 1000);
  return feetToMm(value);
}

/** Wall length along which an opening slides. */
export function wallLength(wall: Wall, width_mm: number, length_mm: number): number {
  return wall === "bottom" || wall === "top" ? width_mm : length_mm;
}

function centred(wall: Wall, width_mm: number, length_mm: number, opening_mm: number, corner: boolean): Opening {
  const run = wallLength(wall, width_mm, length_mm);
  const offset = corner ? 150 : Math.max(0, Math.round((run - opening_mm) / 2));
  return { wall, offset_mm: offset, width_mm: Math.min(opening_mm, run) };
}

function wallFromWord(word: string, width_mm: number, length_mm: number): Wall {
  const w = word.toLowerCase();
  const widthIsShort = width_mm <= length_mm;
  if (w === "short") return widthIsShort ? "bottom" : "left";
  if (w === "long") return widthIsShort ? "left" : "bottom";
  if (w === "left" || w === "west") return "left";
  if (w === "right" || w === "east") return "right";
  if (w === "top" || w === "far" || w === "north" || w === "back") return "top";
  return "bottom";
}

function findOpening(text: string, kind: "door" | "window", width_mm: number, length_mm: number, opening_mm: number): Opening | null {
  const re = new RegExp(`${kind}s?\\b([^.;]*?)\\b(?:on|in|at|along)\\s+the\\s+(short|long|left|right|top|bottom|far|near|north|south|east|west|back|front)\\b`, "i");
  const m = text.match(re);
  if (m) return centred(wallFromWord(m[2], width_mm, length_mm), width_mm, length_mm, opening_mm, /corner/i.test(m[1]) || /corner/i.test(text.slice(m.index ?? 0, (m.index ?? 0) + m[0].length + 20)));
  if (new RegExp(`\\b${kind}s?\\b`, "i").test(text)) {
    // Mentioned without a wall: a door defaults to the short wall, a window to the long wall.
    const wall: Wall = kind === "door" ? (width_mm <= length_mm ? "bottom" : "left") : width_mm <= length_mm ? "left" : "bottom";
    return centred(wall, width_mm, length_mm, opening_mm, false);
  }
  return null;
}

export function estimateRoom(text: string): RoomEstimate {
  const pair = text.match(PAIR);
  let width_mm = DEFAULT_ROOM.width_mm;
  let length_mm = DEFAULT_ROOM.length_mm;
  if (pair) {
    const unit = pair[4] ?? pair[2];
    width_mm = toMm(Number(pair[1]), unit);
    length_mm = toMm(Number(pair[3]), unit);
  }
  const h = text.match(HEIGHT);
  const height_mm = h ? toMm(Number(h[1] ?? h[3]), h[2] ?? h[4]) : null;
  const named = ROOM_NAMES.find((n) => text.toLowerCase().includes(n));
  const name = named ? named[0].toUpperCase() + named.slice(1) : DEFAULT_ROOM.name;
  return {
    name,
    width_mm,
    length_mm,
    height_mm,
    door: findOpening(text, "door", width_mm, length_mm, DOOR_WIDTH_MM),
    window: findOpening(text, "window", width_mm, length_mm, WINDOW_WIDTH_MM)
  };
}

/** Sentence for the "Describe the room" field from a stored space, e.g. "12 by 18 living room". */
export function describeSpace(space: { name: string; width_mm: number; length_mm: number; height_mm: number | null }): string {
  const ft = (mm: number) => {
    const v = mm / 304.8;
    return Number.isInteger(Math.round(v * 10) / 10) ? String(Math.round(v)) : (Math.round(v * 10) / 10).toString();
  };
  const base = `${ft(space.width_mm)} by ${ft(space.length_mm)} ${space.name.toLowerCase()}`;
  return space.height_mm ? `${base}, ${ft(space.height_mm)} ft ceiling` : base;
}
