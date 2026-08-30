/** Strings for the pages: money without a thousands separator and times as ISO minutes so no rendered string carries a comma (PRD Section 2). */
export const money = (cents: number, currency: string) => `${(cents / 100).toFixed(2)} ${currency}`;
export const minute = (iso: string) => iso.slice(0, 16).replace("T", " ");
export const fromPrice = (bands: { unit_cents: number }[]) => Math.min(...bands.map((b) => b.unit_cents));
