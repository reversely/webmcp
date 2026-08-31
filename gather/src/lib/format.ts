/** Display helpers for money in cents and ISO dates; the records stay in cents and ISO. */
export function money(cents: number | null | undefined, currency = "CAD"): string {
  if (cents === null || cents === undefined) return "";
  return new Intl.NumberFormat("en-CA", { style: "currency", currency, useGrouping: false, maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
}

/** Intl separates date parts with commas; page strings are one clause with no comma, so join with spaces instead (issue #114). */
function noCommas(formatted: string): string {
  return formatted.replaceAll(", ", " ").replaceAll(",", " ");
}

/**
 * Read the ISO's wall-clock parts as UTC so the server (UTC) and the client (its own zone) print
 * the same string; a runtime-zone formatter diverged between the two paints and React warned of a
 * hydration mismatch (issue #142). Any trailing Z or offset is dropped before the parts are pinned.
 */
function fixedDate(iso: string): Date {
  return new Date(`${iso.replace(/(?:Z|[+-]\d{2}:?\d{2})$/, "")}Z`);
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = fixedDate(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return noCommas(new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(d));
}

export function dateOnly(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = fixedDate(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return noCommas(new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(d));
}
