/**
 * Turns whatever a person types as a delivery address into a `DeliveryAddress`.
 *
 * A bare ZIP is completed from a small prefix table (first three digits) covering the metros the
 * demo ships to; any other US prefix keeps country and ZIP with city and region null. A line of the
 * form `street, City, ST 12345` is split into its parts and marked `given`.
 */
import type { DeliveryAddress } from "../types";

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
    source: "inferred"
  };
}

/**
 * Raises:
 *   Error when the input carries no ZIP code, since a project address needs at least that.
 */
export function inferAddress(given: string): DeliveryAddress {
  const text = given.trim();
  const zipOnly = BARE_ZIP.exec(text);
  if (zipOnly) return fromZip(zipOnly[1]);

  const line = ADDRESS_LINE.exec(text);
  if (line) {
    const [, street, city, state, postalCode] = line;
    return {
      line1: street?.trim() ?? null,
      city: city.trim(),
      region: state.toUpperCase(),
      postal_code: postalCode,
      country: "US",
      source: "given"
    };
  }

  const embeddedZip = /\b(\d{5})(?:-\d{4})?\b/.exec(text);
  if (embeddedZip) return { ...fromZip(embeddedZip[1]), line1: text };

  throw new Error(`No postal code found in address: ${given}`);
}
