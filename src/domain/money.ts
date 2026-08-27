/**
 * Money display. Amounts are integer minor units (cents) throughout the domain (types.ts), so the
 * formatter decides only how many fraction digits to show: none when the amount is a whole unit,
 * two otherwise. The currency symbol comes from Intl so a non-USD product keeps its own sign.
 */
export function formatMoney(cents: number, currency = "USD"): string {
  const whole = Number.isInteger(cents / 100);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2
  }).format(cents / 100);
}
