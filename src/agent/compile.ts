/**
 * Model-backed compilation of board content into the ProjectSpec of PRD 16, and the room estimate
 * of PRD 20 stage 2. Both return null on any model failure so the UI's rule-based path stays the
 * fallback.
 */
import { z } from "zod";
import { Kind, Relation } from "../domain/types";
import { structuredCall } from "./model";

const HEX = z.string().regex(/^#[0-9a-f]{6}$/i).describe("A hex colour, #rrggbb");

/**
 * PRD 16 ProjectSpecSchema, with nulls instead of optionals so strict JSON-schema output accepts
 * it. Items are the board's own phrases with the kind the agent infers; colours are hex; layout
 * rules are relations between named items; the room is in millimetres.
 */
export const ProjectSpec = z.object({
  room: z.object({ width_mm: z.number().int(), length_mm: z.number().int() }).nullable(),
  room_name: z.string().nullable(),
  budget: z.object({ maximum: z.number(), currency: z.literal("USD") }).nullable(),
  required_by: z.string().nullable().describe("ISO date YYYY-MM-DD or null"),
  required_items: z.array(z.object({ name: z.string().describe("The item in the board's own words, e.g. \"reading chair\""), kind: Kind.nullable() })),
  visual_direction: z.object({ base: z.array(HEX), accent: z.array(HEX) }),
  suggested_colours: z
    .array(z.object({ hex: HEX, from_text: z.string().describe("The note phrase the colour came from") }))
    .describe("Colours the notes name in words, each as a representative hex; a person keeps or drops them as swatches"),
  layout_requirements: z.array(
    z.object({
      relation: Relation,
      subject: z.string().describe("The item the rule is about, in the board's words"),
      objects: z.array(z.string()).describe("The items it relates to, in the board's words; empty for against_wall and clear_around"),
      distance_mm: z.number().int().nullable()
    })
  )
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
  "Compile whiteboard notes for a room-furnishing project into the specification. Room sizes are in millimetres " +
  "(a bare \"12 x 18\" is feet; 1 ft = 304.8 mm; convert metres). Budget is the maximum in dollars. required_by is the " +
  `delivery deadline as an ISO date; the current year is ${new Date().getUTCFullYear()} and the date is in the future. ` +
  "required_items lists every furniture item the notes name, each in the writer's own words with its qualifiers kept " +
  "(\"reading chair\", \"Coffee Table for 4\", \"big rug\"); a comma or 'and' list in one note is several items. " +
  "A note that names only colours (\"Dark blue, grey white\") is never an item: put each colour into suggested_colours " +
  "with a representative hex and the phrase it came from. " +
  "with its rendering kind: seating, table, storage, soft_floor (rugs), bed, lighting, decor, or other; null when unsure. " +
  "A note that only states where an item goes (\"big rug under the desk\") still names its subject as an item. " +
  "visual_direction takes the swatch hex values only: lighter and warmer ones are base, darker or saturated ones accent; " +
  "never put colour words into visual_direction; they belong in suggested_colours. layout_requirements turns each spatial sentence into a relation (under, on_top_of, " +
  "beside, facing, against_wall, clear_around) between the items as named; \"everything\" means every other item. " +
  "Use null for anything the notes do not state.";

export async function compileSpec(boardText: string[], swatches: string[]): Promise<ProjectSpec | null> {
  const text = `Board text:\n${boardText.map((t) => `- ${t}`).join("\n") || "(none)"}\n\nSwatches:\n${swatches.map((c) => `- ${c}`).join("\n") || "(none)"}`;
  return structuredCall(ProjectSpec, "project_spec", COMPILE_INSTRUCTIONS, [{ type: "input_text", text }]);
}

const ROOM_INSTRUCTIONS =
  "Turn a sentence describing a room into millimetre dimensions. Feet are the default unit; a bare " +
  "\"12 by 18\" is 12 ft by 18 ft. width_mm is the first number, length_mm the second. Walls: bottom and " +
  "top run along the width, left and right along the length. A door or window is an opening on a wall " +
  "with offset_mm from the wall's origin end; a door is 914 mm wide and a window 1219 mm unless stated. " +
  "Centre an opening on its wall when no position is given. Leave room_name null when the board does not name the room.";

export async function estimateRoom(text: string): Promise<RoomEstimate | null> {
  return structuredCall(RoomEstimate, "room_estimate", ROOM_INSTRUCTIONS, [{ type: "input_text", text }]);
}
