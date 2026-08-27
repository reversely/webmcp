/**
 * Turns whatever a person types as a delivery address into a `DeliveryAddress`.
 *
 * The model's reading of the text (`ExtractedAddress`, cached per text in the server state by
 * `src/agent/address.ts`) is the primary source and covers any country. Without a reading, a US
 * ZIP is completed from a small prefix table covering the metros the demo ships to, and a line of
 * the form `street, City, ST 12345` is split into its parts. Text that no path can read is kept
 * verbatim as `line1` with no country, so the run never asks the address question twice.
 */
import { appState } from "../../server/state";
import { ADDRESS_FIELDS, type DeliveryAddress, type ExtractedAddress } from "../types";

/** Cache key for one reply: whitespace and case never distinguish two readings of the same text. */
export function extractionKey(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

interface ZipPrefixRange {
  from: number;
  to: number;
  city: string | null;
  region: string;
}

// Specific metros precede the state-wide CA range so 941 resolves to San Francisco before "CA, city
// unknown". Lookup is a scan over a dozen rows, so no index is needed.
const ZIP_PREFIXES: ZipPrefixRange[] = [
  { from: 21, to: 22, city: "Boston", region: "MA" },
  { from: 100, to: 104, city: "New York", region: "NY" },
  { from: 606, to: 606, city: "Chicago", region: "IL" },
  { from: 900, to: 901, city: "Los Angeles", region: "CA" },
  { from: 921, to: 921, city: "San Diego", region: "CA" },
  { from: 941, to: 941, city: "San Francisco", region: "CA" },
  { from: 900, to: 961, city: null, region: "CA" },
  { from: 981, to: 981, city: "Seattle", region: "WA" }
];

const BARE_ZIP = /^(\d{5})(?:-\d{4})?$/;
const ADDRESS_LINE = /^(?:(.+?),\s*)?([^,]+),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/;

function fromZip(postalCode: string): DeliveryAddress {
  const prefix = Number(postalCode.slice(0, 3));
  const match = ZIP_PREFIXES.find((row) => prefix >= row.from && prefix <= row.to);
  return {
    line1: null,
    city: match?.city ?? null,
    region: match?.region ?? null,
    postal_code: postalCode,
    country: "US",
    currency: "USD",
    source: "inferred",
    inferred_fields: ["country", ...(match?.city ? (["city"] as const) : []), ...(match ? (["region"] as const) : [])]
  };
}

/** The address a person's text describes when no path could read it: the text itself, with no destination. */
export function unreadAddress(text: string): DeliveryAddress {
  return { line1: text.trim(), city: null, region: null, postal_code: "", country: null, currency: null, source: "given", inferred_fields: [] };
}

/** True when the address carries no destination a merchant could quote against. */
export function hasDestination(address: DeliveryAddress): boolean {
  return address.country !== null && (address.postal_code !== "" || address.city !== null);
}

function fromExtraction(extracted: ExtractedAddress): DeliveryAddress {
  const stated = new Set(extracted.stated_fields);
  const inferred = ADDRESS_FIELDS.filter((field) => extracted[field] !== null && !stated.has(field));
  return {
    line1: extracted.line1,
    city: extracted.city,
    region: extracted.region,
    postal_code: extracted.postal_code ?? "",
    country: extracted.country,
    currency: extracted.currency,
    source: stated.has("line1") || stated.has("city") ? "given" : "inferred",
    inferred_fields: inferred
  };
}

/** A US ZIP path for the no-key fallback: bare, in a `street, City, ST ZIP` line, or embedded in text. */
function fromZipText(text: string): DeliveryAddress | null {
  const zipOnly = BARE_ZIP.exec(text);
  if (zipOnly) return fromZip(zipOnly[1]);
  const line = ADDRESS_LINE.exec(text);
  if (line) {
    const [, street, city, state, postalCode] = line;
    return { line1: street?.trim() ?? null, city: city.trim(), region: state.toUpperCase(), postal_code: postalCode, country: "US", currency: "USD", source: "given", inferred_fields: ["country"] };
  }
  const embeddedZip = /\b(\d{5})(?:-\d{4})?\b/.exec(text);
  return embeddedZip ? { ...fromZip(embeddedZip[1]), line1: text } : null;
}

/**
 * The address for a reply. `extracted` is the model's reading; when omitted, the reading cached
 * for this text in the server state is used, so a caller that primed the cache (the messages
 * route) gets the model's answer from this synchronous call. A cached null (the model read no
 * address) and an absent reading with no ZIP both keep the text verbatim with no destination.
 */
export function inferAddress(given: string, extracted?: ExtractedAddress | null): DeliveryAddress {
  const text = given.trim();
  const reading = extracted === undefined ? appState().addressExtractions.get(extractionKey(text)) : extracted;
  if (reading) return fromExtraction(reading);
  if (reading === undefined) {
    const zip = fromZipText(text);
    if (zip) return zip;
  }
  return unreadAddress(text);
}
