/**
 * Model-backed compilation of board content into the ProjectSpec of PRD 16, and the room estimate
 * of PRD 20 stage 2. Both return null on any model failure so the UI's rule-based path stays the
 * fallback.
 */
import { z } from "zod";
import { structuredCall } from "./model";

const RequiredItem = z.enum(["sofa", "coffee_table", "ottoman", "rug", "side_table"]);

/** PRD 16 ProjectSpecSchema, with nulls instead of optionals so strict JSON-schema output accepts it. */
export const ProjectSpec = z.object({
  room: z.object({ width_ft: z.number(), length_ft: z.number() }).nullable(),
  room_name: z.string().nullable(),
  budget: z.object({ maximum: z.number(), currency: z.literal("USD") }).nullable(),
  required_by: z.string().nullable().describe("ISO date YYYY-MM-DD or null"),
  required_items: z.array(RequiredItem),
  visual_direction: z.object({ base_colors: z.array(z.string()), accent_colors: z.array(z.string()) }),
  layout_requirements: z.array(z.object({ type: z.literal("rug_encompasses_group"), items: z.array(RequiredItem) }))
});
export type ProjectSpec = z.infer<typeof ProjectSpec>;

const Opening = z.object({ wall: z.enum(["bottom", "top", "left", "right"]), offset_mm: z.number().int(), width_mm: z.number().int() });

export const RoomEstimate = z.object({
  name: z.string(),
  width_mm: z.number().int(),
  length_mm: z.number().int(),
  height_mm: z.number().int().nullable(),
  door: Opening.nullable(),
  window: Opening.nullable()
});
export type RoomEstimate = z.infer<typeof RoomEstimate>;

const COMPILE_INSTRUCTIONS =
  "Compile whiteboard notes for a living-room project into the specification. Room sizes are in feet " +
  "(convert metres). Budget is the maximum in dollars. required_by is the delivery deadline as an ISO " +
  `date; the current year is ${new Date().getUTCFullYear()} and the date is in the future. Colour swatches ` +
  "are hex or named colours: warm browns, beiges, creams and warm neutrals are base colours; a dark blue " +
  "or other saturated colour is an accent. Add a rug_encompasses_group requirement over sofa and " +
  "coffee_table when the notes ask for a rug under the group. Use null for anything the notes do not state.";

export async function compileSpec(boardText: string[], swatches: string[]): Promise<ProjectSpec | null> {
  const text = `Board text:\n${boardText.map((t) => `- ${t}`).join("\n") || "(none)"}\n\nSwatches:\n${swatches.map((c) => `- ${c}`).join("\n") || "(none)"}`;
  return structuredCall(ProjectSpec, "project_spec", COMPILE_INSTRUCTIONS, [{ type: "input_text", text }]);
}

const ROOM_INSTRUCTIONS =
  "Turn a sentence describing a room into millimetre dimensions. Feet are the default unit; a bare " +
  "\"12 by 18\" is 12 ft by 18 ft. width_mm is the first number, length_mm the second. Walls: bottom and " +
  "top run along the width, left and right along the length. A door or window is an opening on a wall " +
  "with offset_mm from the wall's origin end; a door is 914 mm wide and a window 1219 mm unless stated. " +
  "Centre an opening on its wall when no position is given. Default name is \"Living room\".";

export async function estimateRoom(text: string): Promise<RoomEstimate | null> {
  return structuredCall(RoomEstimate, "room_estimate", ROOM_INSTRUCTIONS, [{ type: "input_text", text }]);
}
