/**
 * Reads a delivery address out of a chat reply with the model (any country; PRD 10). The reading
 * is cached per text in the server state, so `inferAddress` (src/domain/delivery/address.ts) can
 * pick it up synchronously once `extractAddress` or `primeAddressReply` has run for that text.
 */
import { extractionKey, inferAddress } from "../domain/delivery";
import { ExtractedAddress, type DeliveryAddress } from "../domain/types";
import { appState } from "../server/state";
import { withProject } from "../server/trace";
import { structuredCall } from "./model";

const INSTRUCTIONS =
  "A person was asked for a delivery address in a room-planning chat and replied with the text below. Decide whether the " +
  "text states an address or a postal code anywhere in the world; a request, a question, or a remark about the room is not " +
  "one. For an address, read every part the text states and fill in what its postal code implies: the city, region, and " +
  "country a postal code format and place names identify (a Canadian forward sortation area gives the city and province; a " +
  "UK postcode gives the town and country; a US ZIP gives the city and state), the ISO 3166-1 alpha-2 country code, and " +
  "the ISO 4217 currency of that country. Write the postal code in the country's canonical form, keeping any internal " +
  "space. List under stated_fields only the fields the text itself contains.";

/** True when the reading can stand as a destination: a postal code, or a city with its country. */
function usable(reading: ExtractedAddress): boolean {
  return reading.is_address && (reading.postal_code !== null || (reading.city !== null && reading.country !== null));
}

/**
 * The model's reading of `text`, or null when it is not an address. Cached per text in the server
 * state; a call without a model key or with a failed call caches nothing, so the ZIP fallback in
 * `inferAddress` stays available for that text.
 */
export async function extractAddress(text: string): Promise<ExtractedAddress | null> {
  const key = extractionKey(text);
  const cache = appState().addressExtractions;
  if (cache.has(key)) return cache.get(key) ?? null;
  const reading = await structuredCall(ExtractedAddress, "extract_address", INSTRUCTIONS, [{ type: "input_text", text: text.trim() }]);
  if (!reading) return null;
  const result = usable(reading) ? reading : null;
  cache.set(key, result);
  return result;
}

/** The address a reply describes: the model's reading, else the ZIP fallback, else the text verbatim. */
export async function resolveAddress(text: string): Promise<DeliveryAddress> {
  await extractAddress(text);
  return inferAddress(text);
}

/** Fills the extraction cache for a reply when the project's run is waiting for its address. */
export async function primeAddressReply(projectId: string, text: string): Promise<void> {
  const s = appState();
  const runId = s.activeRuns.get(projectId);
  const run = runId ? s.runs.get(runId) : undefined;
  // Runs under the project so the extract_address span lands in its trace.
  if (run?.status === "waiting_for_user" && run.missing_fields_json.includes("delivery_address")) await withProject(projectId, () => extractAddress(text));
}
