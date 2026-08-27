/**
 * Compiles whiteboard content into the project spec of PRD 16 with rules alone: no model call.
 * The input is the list of text and swatch items read off a tldraw snapshot (collectBoardItems);
 * the output mirrors ProjectSpecSchema so the approve step can write Space, Project, and
 * Requirement rows from it.
 */

export type BoardItem = { kind: "text"; text: string } | { kind: "swatch"; colour: string };

export type SwatchTag = "base" | "accent";

/** A colour read off the board as a hex string; the tag is a first guess the person can flip. */
export type Swatch = { hex: string; tag: SwatchTag };

export type CompiledSpec = {
  room: { width_ft: number; length_ft: number } | null;
  room_name: string | null;
  budget: { maximum: number; currency: "USD" } | null;
  required_by: string | null;
  /** The board's own words for each item, in board order. */
  required_items: string[];
  swatches: Swatch[];
  /** Board lines that state a spatial relation, verbatim; parseLayoutRule turns one into a requirement value. */
  layout_rules: string[];
};

import type { LayoutRule, Relation } from "../../../../domain/types";

export type { LayoutRule, Relation };

const FT_PER_M = 1 / 0.3048;

// One length: a number, an optional unit, and an optional inch part ("12'6\"", "12 ft 6 in").
const LEN = String.raw`(\d+(?:\.\d+)?)\s*(m\b|metres?\b|meters?\b|ft\b|feet\b|foot\b|'|′)?\s*(?:(\d{1,2})\s*(?:"|″|in\b|inches\b))?`;
const DIM = new RegExp(`${LEN}\\s*(?:x|×|by|\\*)\\s*${LEN}`, "i");

function isMetric(unit: string | undefined) {
  return !!unit && unit[0].toLowerCase() === "m";
}

export function parseDimensions(text: string): { width_ft: number; length_ft: number } | null {
  const m = DIM.exec(text);
  if (!m) return null;
  const [, a, unitA, inchA, b, unitB, inchB] = m;
  const metric = isMetric(unitA) || isMetric(unitB);
  const toFeet = (n: string, inch: string | undefined) => {
    const base = parseFloat(n);
    if (metric) return Math.round(base * FT_PER_M * 100) / 100;
    return Math.round((base + (inch ? parseInt(inch, 10) / 12 : 0)) * 100) / 100;
  };
  const width_ft = toFeet(a, inchA);
  const length_ft = toFeet(b, inchB);
  const plausible = (ft: number) => ft >= 3 && ft <= 200;
  if (!plausible(width_ft) || !plausible(length_ft)) return null;
  return { width_ft, length_ft };
}

/**
 * The room's name is whatever the dimension note calls it: the words left in that note once the
 * dimension pair and its unit are removed ("12 x 18 living room" → "living room"). No list of
 * room types exists in the app.
 */
export function roomNameFrom(text: string): string | null {
  const m = DIM.exec(text);
  if (!m) return null;
  const rest = text.replace(m[0], " ").replace(/\b(?:ft|feet|foot|m|metres?|meters?|by|x|room size|size)\b/gi, " ").replace(/[^\p{L}\p{N} '-]/gu, " ").replace(/\s+/g, " ").trim();
  return rest ? rest.toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : null;
}

const BUDGET_PATTERNS = [
  /\$\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?\b/i,
  /\b(\d[\d,]*(?:\.\d+)?)\s*(k)?\s*(?:dollars|usd|bucks)\b/i,
  /\bbudget\b\D{0,12}?(\d[\d,]*(?:\.\d+)?)\s*(k)?\b/i
];

export function parseBudget(text: string): number | null {
  for (const re of BUDGET_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const amount = parseFloat(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1);
    if (Number.isFinite(amount) && amount > 0) return Math.round(amount * 100) / 100;
  }
  return null;
}

const MONTHS = [
  "jan(?:uary)?", "feb(?:ruary)?", "mar(?:ch)?", "apr(?:il)?", "may", "jun(?:e)?",
  "jul(?:y)?", "aug(?:ust)?", "sep(?:t)?(?:ember)?", "oct(?:ober)?", "nov(?:ember)?", "dec(?:ember)?"
];
const MONTH_RE = MONTHS.map((m, i) => `(?<m${i}>${m})`).join("|");
const DAY = String.raw`(\d{1,2})(?:st|nd|rd|th)?`;
const MONTH_DAY = new RegExp(String.raw`\b(?:${MONTH_RE})\.?\s+${DAY}(?:,?\s*(\d{4}))?\b`, "i");
const DAY_MONTH = new RegExp(String.raw`\b${DAY}\s+(?:${MONTH_RE})\.?(?:,?\s*(\d{4}))?\b`, "i");
const ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/;
const SLASH = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/;

function monthIndex(groups: Record<string, string | undefined> | undefined): number {
  if (!groups) return -1;
  for (let i = 0; i < 12; i++) if (groups[`m${i}`]) return i;
  return -1;
}

function iso(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Resolves a month and day with no year to the next occurrence on or after `today`. */
function nextOccurrence(month: number, day: number, today: string) {
  const year = parseInt(today.slice(0, 4), 10);
  const candidate = iso(year, month, day);
  return candidate >= today ? candidate : iso(year + 1, month, day);
}

export function parseRequiredDate(text: string, today: string): string | null {
  const isoMatch = ISO.exec(text);
  if (isoMatch) return isoMatch[0];
  const md = MONTH_DAY.exec(text);
  if (md) {
    const month = monthIndex(md.groups) + 1;
    const day = parseInt(md[md.length - 2], 10);
    const year = md[md.length - 1];
    if (day >= 1 && day <= 31) return year ? iso(parseInt(year, 10), month, day) : nextOccurrence(month, day, today);
  }
  const dm = DAY_MONTH.exec(text);
  if (dm) {
    const day = parseInt(dm[1], 10);
    const month = monthIndex(dm.groups) + 1;
    const year = dm[dm.length - 1];
    if (day >= 1 && day <= 31) return year ? iso(parseInt(year, 10), month, day) : nextOccurrence(month, day, today);
  }
  const sl = SLASH.exec(text);
  if (sl) {
    const month = parseInt(sl[1], 10);
    const day = parseInt(sl[2], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      if (!sl[3]) return nextOccurrence(month, day, today);
      const y = sl[3].length === 2 ? 2000 + parseInt(sl[3], 10) : parseInt(sl[3], 10);
      return iso(y, month, day);
    }
  }
  return null;
}

/* ---- Required items: the board's own noun phrases ---- */

const NEGATED = /^(?:no|without|skip|not|never|don'?t\s+(?:need|want)|nothing)\b/i;
const LEAD = /^(?:(?:we|i)\s+)?(?:need|needs|want|wants|get|buy|add|find|must\s+have|also|plus|maybe|probably|definitely|a|an|the|one|two|some|new|another|\d+x?)\b\s*/i;
/** A trailing clause that describes where or how the item goes, not what it is. */
const TAIL = /\s+(?:under(?:neath)?|beneath|below|on top of|next to|beside|for|with|that|which|in|on|by|near|to|from|so|because)\b.*$/i;
const SPLIT = /\s*(?:,|;|\n|\band\b|&|\+|\/)\s*/i;
const MAX_ITEM_WORDS = 4;

/** Whether a line states a fact the fixed fields carry (size, money, date) rather than an item. */
function isStructured(text: string, today: string): boolean {
  return parseDimensions(text) !== null || parseBudget(text) !== null || parseRequiredDate(text, today) !== null;
}

/**
 * Reads the items a line names, in the writer's words: "Need sofa" gives "sofa", "big rug underneath
 * everything" gives "big rug", "a couch and an end table, no ottoman" gives "couch" and "end table".
 */
export function parseItems(text: string, today = new Date().toISOString().slice(0, 10)): string[] {
  if (isStructured(text, today)) return [];
  const items: string[] = [];
  for (const segment of text.split(SPLIT)) {
    let phrase = segment.trim();
    if (!phrase || NEGATED.test(phrase)) continue;
    let previous = "";
    while (previous !== phrase) {
      previous = phrase;
      phrase = phrase.replace(LEAD, "");
    }
    phrase = phrase.replace(TAIL, "").replace(/[.!?:]+$/, "").trim();
    const words = phrase.split(/\s+/).filter(Boolean);
    if (words.length === 0 || words.length > MAX_ITEM_WORDS) continue;
    items.push(phrase);
  }
  return items;
}

/* ---- Layout rules: relations the board states between items ---- */

const RELATIONS: [Relation, RegExp][] = [
  ["under", /\b(?:under(?:neath)?|beneath|below)\b/i],
  ["on_top_of", /\b(?:on top of|atop)\b/i],
  ["beside", /\b(?:beside|next to|alongside)\b/i],
  ["facing", /\b(?:facing|faces|face|across from|opposite)\b/i],
  ["against_wall", /\bagainst\s+(?:the\s+|a\s+)?(?:\w+\s+)?walls?\b/i],
  ["clear_around", /\b(?:clear(?:ance)?\s+around|space\s+around|room\s+around|walkway\s+around)\b/i]
];
const EVERYTHING = /^(?:everything|all(?:\s+of\s+(?:it|them))?|the\s+rest|the\s+others?|all\s+the\s+(?:other\s+)?items|the\s+(?:whole\s+)?(?:group|set))$/i;

export function isLayoutRule(text: string): boolean {
  return RELATIONS.some(([, re]) => re.test(text));
}

function cleanPhrase(text: string): string {
  let phrase = text.trim();
  let previous = "";
  while (previous !== phrase) {
    previous = phrase;
    phrase = phrase.replace(LEAD, "");
  }
  return phrase.replace(/[.!?:]+$/, "").trim();
}

/**
 * Reads one layout sentence into a requirement value. "big rug underneath everything" with items
 * sofa, coffee table, rug gives { relation: "under", subject: "big rug", objects: [sofa, coffee table] }.
 * A sentence with no recognisable relation, or no item on either side, is kept as text.
 */
/**
 * Maps a phrase from a rule sentence onto the item it refers to: "desk" resolves to "standing desk"
 * and "the chair" to "reading chair" when those are the project's items. Unmatched phrases stay as
 * written so the form shows what the board said.
 */
export function resolveItem(phrase: string, items: string[]): string {
  const words = phrase.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return phrase;
  const exact = items.find((i) => i.toLowerCase() === phrase.toLowerCase());
  if (exact) return exact;
  const last = words[words.length - 1];
  const candidates = items.filter((i) => i.toLowerCase().split(/\s+/).includes(last));
  if (candidates.length === 1) return candidates[0];
  const byAll = candidates.find((i) => words.every((w) => i.toLowerCase().includes(w)));
  return byAll ?? (candidates[0] ?? phrase);
}

export function parseLayoutRule(sentence: string, items: string[] = []): LayoutRule {
  const text = sentence.trim();
  for (const [relation, re] of RELATIONS) {
    const m = re.exec(text);
    if (!m) continue;
    const before = cleanPhrase(text.slice(0, m.index));
    const after = cleanPhrase(text.slice(m.index + m[0].length));
    // "clear around X" names its item after the relation; the words before it are the distance.
    const subject = relation === "clear_around" ? after || before : before || after;
    if (!subject) break;
    const rest = before && relation !== "clear_around" ? after : "";
    const objects = rest
      .split(SPLIT)
      .map(cleanPhrase)
      .filter(Boolean)
      .flatMap((o) => (EVERYTHING.test(o) ? items.filter((i) => i.toLowerCase() !== subject.toLowerCase()) : [o]));
    return { relation, subject: resolveItem(subject, items), objects: dedupe(objects.map((o) => resolveItem(o, items))) };
  }
  return { relation: "text", text };
}

/* ---- Colours: swatch fills, never colour words ---- */

const HEX = /#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/i;

/** Relative luminance of a hex colour, 0 (black) to 1 (white); enough to guess base against accent. */
export function luminance(hex: string): number {
  const full = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const channel = (i: number) => parseInt(full.slice(i, i + 2), 16) / 255;
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** Lighter swatches read as base colours, darker ones as accents; a person flips any tag in the form. */
export function tagSwatches(hexes: string[]): Swatch[] {
  if (hexes.length === 0) return [];
  const sorted = hexes.map(luminance).sort((a, b) => a - b);
  const median = sorted[Math.ceil((sorted.length - 1) / 2)];
  return hexes.map((hex) => ({ hex, tag: hexes.length === 1 || luminance(hex) >= median ? "base" : "accent" }));
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  return list.filter((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function compileBoard(items: BoardItem[], options: { today?: string } = {}): CompiledSpec {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const spec: CompiledSpec = { room: null, room_name: null, budget: null, required_by: null, required_items: [], swatches: [], layout_rules: [] };
  const hexes: string[] = [];
  for (const item of items) {
    if (item.kind === "swatch") {
      const hex = HEX.exec(item.colour)?.[0].toLowerCase();
      if (hex) hexes.push(hex);
      continue;
    }
    const text = item.text;
    if (!spec.room) spec.room = parseDimensions(text);
    if (!spec.room_name) spec.room_name = roomNameFrom(text);
    if (!spec.budget) {
      const maximum = parseBudget(text);
      if (maximum != null) spec.budget = { maximum, currency: "USD" };
    }
    if (!spec.required_by) spec.required_by = parseRequiredDate(text, today);
    if (!isStructured(text, today) && isLayoutRule(text)) {
      // A rule sentence names its subject as an item ("big rug under…" adds the rug) but its
      // objects refer to items named elsewhere, so they never become items of their own.
      spec.layout_rules.push(text);
      const rule = parseLayoutRule(text);
      if (rule.relation !== "text" && rule.subject) spec.required_items.push(rule.subject);
    } else {
      spec.required_items.push(...parseItems(text, today));
    }
  }
  spec.required_items = dedupe(spec.required_items);
  spec.swatches = tagSwatches(dedupe(hexes));
  spec.layout_rules = dedupe(spec.layout_rules);
  return spec;
}

/* ---- Reading a tldraw snapshot ---- */

type RichNode = { type?: string; text?: string; content?: RichNode[] };

/** Flattens a tldraw rich-text document (TipTap JSON) to plain text, one line per paragraph. */
export function richTextToPlain(doc: unknown): string {
  const walk = (node: RichNode): string => {
    if (node.type === "text") return node.text ?? "";
    if (node.type === "hardBreak") return "\n";
    const inner = (node.content ?? []).map(walk);
    return node.type === "paragraph" || node.type === "heading" ? inner.join("") + "\n" : inner.join("");
  };
  if (!doc || typeof doc !== "object") return "";
  return walk(doc as RichNode).trim();
}

type ShapeRecord = {
  typeName?: string;
  type?: string;
  props?: { richText?: unknown; text?: string; fill?: string; color?: string };
};

/** tldraw's default light-theme palette, by style colour name. */
export const TLDRAW_HEX: Record<string, string> = {
  black: "#1d1d1d",
  grey: "#9fa8b2",
  "light-violet": "#e085f4",
  violet: "#ae3ec9",
  blue: "#4263eb",
  "light-blue": "#4dabf7",
  yellow: "#ffc034",
  orange: "#f76707",
  green: "#099268",
  "light-green": "#40c057",
  "light-red": "#ff8787",
  red: "#e03131",
  white: "#ffffff"
};

/**
 * Reads the board items from a tldraw editor or store snapshot: note and text shapes become text
 * items; filled geo shapes become swatches carrying a hex colour, taken from a hex typed into the
 * shape's label when there is one, otherwise from the shape's tldraw fill colour.
 */
export function collectBoardItems(snapshot: unknown): BoardItem[] {
  if (!snapshot || typeof snapshot !== "object") return [];
  const s = snapshot as { document?: { store?: Record<string, unknown> }; store?: Record<string, unknown> };
  const store = s.document?.store ?? s.store ?? {};
  const items: BoardItem[] = [];
  for (const record of Object.values(store) as ShapeRecord[]) {
    if (record.typeName !== "shape" || !record.props) continue;
    const label = record.props.richText ? richTextToPlain(record.props.richText) : (record.props.text ?? "");
    if (record.type === "note" || record.type === "text") {
      if (label) items.push({ kind: "text", text: label });
    } else if (record.type === "geo" && record.props.fill && record.props.fill !== "none") {
      const hex = HEX.exec(label)?.[0].toLowerCase() ?? TLDRAW_HEX[record.props.color ?? ""];
      if (hex) items.push({ kind: "swatch", colour: hex });
    }
  }
  return items;
}
