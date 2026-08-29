/**
 * Rendering kind inference (PRD 20): the PlanningAgent reads an item's own phrase ("reading chair",
 * "big rug") and answers with the kind that decides its proxy shape and layout default, plus a short
 * catalog search query for it. Results are cached per name in the server state so a phrase is
 * classified once; a person can overwrite the kind on the catalog table afterwards.
 */
import { z } from "zod";
import { itemKey, Kind } from "../domain/types";
import { appState } from "../server/state";
import { structuredCall } from "./model";

export type KindGuess = { kind: Kind; query: string };

const GuessSchema = z.object({
  kind: Kind.describe("The rendering kind: seating (sofas, chairs, benches), table (any table or desk), storage (shelves, cabinets, dressers), soft_floor (rugs, mats), bed, lighting (lamps), decor (ottomans, plants, art, mirrors), other."),
  query: z.string().describe("A two- to four-word catalog search query for the item, e.g. \"three seat sofa\" or \"area rug 8x10\".")
});

const INSTRUCTIONS =
  "Classify one furniture item named in a person's own words for a room-planning app. Answer with its rendering kind " +
  "and a short product search query a shopping catalog would understand. Keep the person's meaning: \"big rug\" is a " +
  "soft_floor with a large-size query; \"standing desk\" is a table.";

/** The fallback when the model is unavailable: render it as a generic box and search for the phrase itself. */
export function fallbackGuess(name: string): KindGuess {
  return { kind: "other", query: name.trim() };
}

/** The cached guess for a name, or the fallback when nothing has been inferred yet. */
export function kindFor(name: string): KindGuess {
  return appState().kinds.get(itemKey(name)) ?? fallbackGuess(name);
}

/** Records a guess for a name; a person's edit on the catalog table lands here too. */
export function setKind(name: string, guess: KindGuess): KindGuess {
  appState().kinds.set(itemKey(name), guess);
  return guess;
}

/** Asks the model once per name and caches the answer; falls back to `other` and the name itself. */
export async function inferKind(name: string): Promise<KindGuess> {
  const cached = appState().kinds.get(itemKey(name));
  if (cached) return cached;
  const answer = await structuredCall(GuessSchema, "item_kind", INSTRUCTIONS, [{ type: "input_text", text: name.trim() }]);
  const guess: KindGuess = answer && answer.query.trim() ? { kind: answer.kind, query: answer.query.trim() } : fallbackGuess(name);
  return setKind(name, guess);
}
