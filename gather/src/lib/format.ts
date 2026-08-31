/** Display helpers for money in cents and ISO dates; the records stay in cents and ISO. */
export function money(cents: number | null | undefined, currency = "CAD"): string {
  if (cents === null || cents === undefined) return "";
  return new Intl.NumberFormat("en-CA", { style: "currency", currency, maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
}

/** Intl separates date parts with commas; page strings are one clause with no comma, so join with spaces instead (issue #114). */
function noCommas(formatted: string): string {
  return formatted.replaceAll(", ", " ").replaceAll(",", " ");
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return noCommas(new Intl.DateTimeFormat("en-CA", { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(d));
}

export function dateOnly(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return noCommas(new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric" }).format(d));
}
