/**
 * Pure parser for delivery phrasing found in shipping policies and product descriptions.
 *
 * Two shapes are recognised:
 * - an explicit date or date range ("Estimated delivery Sep 9 – Sep 12", "arrives by September 12"),
 *   which becomes an arrival window directly;
 * - a duration ("ships in 3-5 business days", "2 to 3 weeks", "within 24 hours"), which becomes an
 *   arrival window counted from `today`.
 *
 * Duration rules:
 * - "business days" and "working days" count Monday to Friday; "days", "weeks", and "hours" count
 *   calendar time (hours round up to whole days).
 * - A phrase whose verb is ship, dispatch, or send describes when the parcel leaves the merchant,
 *   not when it arrives, so `SHIPPING_BUFFER_BUSINESS_DAYS` is added to both ends of the window.
 *   A bare duration or one with a delivery verb is taken as the delivery window and gets no buffer.
 * - A single number bounded by "within" or "up to" ("within 5 days") gives a window whose earliest
 *   edge is today; an unbounded single number ("3 business days") means that many days, so both
 *   edges coincide.
 */
import { addBusinessDays, addCalendarDays, parseIsoDate, toIsoDate } from "./dates";

/** Ground transit inside one country rarely completes in under two working days. */
export const SHIPPING_BUFFER_BUSINESS_DAYS = 2;

export type DurationUnit = "business_days" | "calendar_days";

export interface ParsedDuration {
  min_days: number;
  max_days: number;
  unit: DurationUnit;
  /** Business days added for a ship-verb phrase; 0 when the phrase already describes delivery. */
  buffer_business_days: number;
}

export interface ArrivalWindow {
  matched_text: string;
  arrival_min: string | null;
  arrival_max: string;
  duration: ParsedDuration | null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12
};

// Full names or the usual abbreviations only, so "decor 5" or "marble 3" never reads as a date.
const MONTH_NAME =
  "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|" +
  "oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const MONTH_DAY = `(${MONTH_NAME})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?`;
const WEEKDAY = "(?:(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?\\.?,?\\s*)?";
// A checkout option can read "Wednesday, September 2–Thursday, September 3"; the weekday after the
// separator is optional noise, as is the one before the first date.
const RANGE_SEPARATOR = "\\s*(?:-|–|—|to|through)\\s*" + WEEKDAY;

const DATE_RANGE = new RegExp(`${MONTH_DAY}${RANGE_SEPARATOR}${MONTH_DAY}`, "i");
const DATE_BY = new RegExp(`\\b(?:by|before)\\s+${MONTH_DAY}`, "i");
const DATE_SINGLE = new RegExp(MONTH_DAY, "i");

const NUMBER = "(\\d+(?:\\.\\d+)?)";
const DURATION = new RegExp(
  `(\\b(?:ships?|shipping|shipped|dispatch(?:es|ed)?|sen[dt])\\b[^.\\d]{0,40}?)?` +
    `(\\b(?:within|up\\s+to)\\s+)?` +
    `${NUMBER}(?:${RANGE_SEPARATOR}${NUMBER})?\\s*` +
    `(business\\s+days?|working\\s+days?|days?|weeks?|hours?|hrs?)\\b`,
  "i"
);

function monthNumber(name: string): number | null {
  const key = name.toLowerCase().replace(".", "");
  return MONTHS[key.slice(0, 4)] ?? MONTHS[key.slice(0, 3)] ?? null;
}

/**
 * Resolves a month and day to the next occurrence on or after `today` when the text names no year,
 * since a policy page quoting "Sep 9" in late December means the coming September.
 */
function resolveDate(month: string, day: string, year: string | undefined, today: string): string | null {
  const monthIndex = monthNumber(month);
  if (monthIndex === null) return null;
  const dayNumber = Number(day);
  const todayDate = parseIsoDate(today);
  const candidateYear = year ? Number(year) : todayDate.getUTCFullYear();
  const candidate = new Date(Date.UTC(candidateYear, monthIndex - 1, dayNumber));
  if (candidate.getUTCMonth() !== monthIndex - 1) return null;
  if (!year && candidate < todayDate) candidate.setUTCFullYear(candidateYear + 1);
  // A dated sentence from a past season ("September 17, 2024") describes an old promise, not an
  // arrival window; treat it as no evidence rather than a confirmed date.
  if (year && candidate < todayDate) return null;
  return toIsoDate(candidate);
}

function parseExplicitDates(text: string, today: string): ArrivalWindow | null {
  const range = DATE_RANGE.exec(text);
  if (range) {
    const min = resolveDate(range[1], range[2], range[3], today);
    const max = resolveDate(range[4], range[5], range[6], today);
    if (min && max) return { matched_text: range[0], arrival_min: min, arrival_max: max, duration: null };
  }
  const by = DATE_BY.exec(text);
  if (by) {
    const max = resolveDate(by[1], by[2], by[3], today);
    if (max) return { matched_text: by[0], arrival_min: null, arrival_max: max, duration: null };
  }
  const single = DATE_SINGLE.exec(text);
  if (single) {
    const date = resolveDate(single[1], single[2], single[3], today);
    if (date) return { matched_text: single[0], arrival_min: date, arrival_max: date, duration: null };
  }
  return null;
}

function toDays(amount: number, unitText: string): { days: number; unit: DurationUnit } {
  const unit = unitText.toLowerCase();
  if (unit.startsWith("business") || unit.startsWith("working")) return { days: Math.ceil(amount), unit: "business_days" };
  if (unit.startsWith("week")) return { days: Math.ceil(amount * 7), unit: "calendar_days" };
  if (unit.startsWith("h")) return { days: Math.ceil(amount / 24), unit: "calendar_days" };
  return { days: Math.ceil(amount), unit: "calendar_days" };
}

function addDays(iso: string, days: number, unit: DurationUnit): string {
  return unit === "business_days" ? addBusinessDays(iso, days) : addCalendarDays(iso, days);
}

function parseDuration(text: string, today: string): ArrivalWindow | null {
  const match = DURATION.exec(text);
  if (!match) return null;
  const [matched, shipVerb, upperBoundOnly, first, second, unitText] = match;
  const max = toDays(Number(second ?? first), unitText);
  const min = second !== undefined ? toDays(Number(first), unitText).days : upperBoundOnly ? 0 : max.days;
  const buffer = shipVerb ? SHIPPING_BUFFER_BUSINESS_DAYS : 0;
  const duration: ParsedDuration = {
    min_days: min,
    max_days: max.days,
    unit: max.unit,
    buffer_business_days: buffer
  };
  return {
    matched_text: matched.trim(),
    arrival_min: addBusinessDays(addDays(today, min, max.unit), buffer),
    arrival_max: addBusinessDays(addDays(today, max.days, max.unit), buffer),
    duration
  };
}

/** Returns the arrival window a phrase implies, or null when the text carries no date or duration. */
export function parseArrivalWindow(text: string, today: string): ArrivalWindow | null {
  return parseExplicitDates(text, today) ?? parseDuration(text, today);
}
