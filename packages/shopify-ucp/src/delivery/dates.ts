/**
 * Calendar arithmetic on ISO `YYYY-MM-DD` strings, in UTC so a local timezone never shifts a day.
 *
 * A business day is Monday to Friday. Public holidays are not modelled: merchant text rarely says
 * which calendar it counts, so the estimate stays a few days optimistic around a holiday.
 */

const MS_PER_DAY = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseIsoDate(value: string): Date {
  if (!ISO_DATE.test(value)) throw new Error(`Not an ISO date: ${value}`);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Not a calendar date: ${value}`);
  return date;
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

export function addCalendarDays(iso: string, days: number): string {
  return toIsoDate(new Date(parseIsoDate(iso).getTime() + days * MS_PER_DAY));
}

/** Steps forward one weekday at a time; a Friday plus one business day lands on Monday. */
export function addBusinessDays(iso: string, days: number): string {
  const date = parseIsoDate(iso);
  let remaining = days;
  while (remaining > 0) {
    date.setTime(date.getTime() + MS_PER_DAY);
    if (!isWeekend(date)) remaining -= 1;
  }
  return toIsoDate(date);
}

/** ISO dates sort lexically, so string comparison is date comparison. */
export function isOnOrBefore(a: string, b: string): boolean {
  return a <= b;
}

export function isAfter(a: string, b: string): boolean {
  return a > b;
}
