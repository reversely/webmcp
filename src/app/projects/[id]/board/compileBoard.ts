/**
 * Compiles whiteboard content into the project spec of PRD 16 with rules alone: no model call.
 * The input is the list of text and swatch items read off a tldraw snapshot (collectBoardItems);
 * the output mirrors ProjectSpecSchema so the approve step can write Space, Project, and
 * Requirement rows from it.
 */

export type BoardItem = { kind: "text"; text: string } | { kind: "swatch"; colour: string };

export type RequiredItem = "sofa" | "coffee_table" | "ottoman" | "rug" | "side_table";

export type CompiledSpec = {
  room: { width_ft: number; length_ft: number } | null;
  room_name: string | null;
  budget: { maximum: number; currency: "USD" } | null;
  required_by: string | null;
  required_items: RequiredItem[];
  visual_direction: { base_colors: string[]; accent_colors: string[] };
  layout_requirements: { type: "rug_encompasses_group"; items: RequiredItem[] }[];
};

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

const ROOM_NAME = /\b(living room|lounge|family room|bedroom|dining room|study|office|den|kitchen)\b/i;

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

const ITEMS: [RequiredItem, string][] = [
  ["sofa", String.raw`(?:sofa|couch|sectional|settee|loveseat)s?`],
  ["coffee_table", String.raw`coffee\s*tables?`],
  ["ottoman", String.raw`ottomans?|footstools?|pouf?fes?`],
  ["rug", String.raw`(?:rug|carpet)s?`],
  ["side_table", String.raw`(?:side|end|accent)\s*tables?`]
];
const NEGATED = String.raw`\b(?:no|without|skip|not|don'?t\s+(?:need|want))\s+(?:a\s+|an\s+|the\s+|any\s+)?(?:\w+\s+){0,2}?`;

export function parseItems(text: string): RequiredItem[] {
  const found: RequiredItem[] = [];
  for (const [item, pattern] of ITEMS) {
    if (!new RegExp(String.raw`\b(?:${pattern})\b`, "i").test(text)) continue;
    if (new RegExp(`${NEGATED}(?:${pattern})\\b`, "i").test(text)) continue;
    found.push(item);
  }
  return found;
}

const RUG_GROUP = /\b(?:under(?:neath)?|beneath|below|encompass\w*|everything|all the|whole group|seating group)\b/i;

const BASE_COLOURS: [string, RegExp][] = [
  ["warm brown", /\b(?:warm\s+brown|brown|walnut|oak|wood(?:en)?|caramel|tan)\b/i],
  ["neutral", /\bneutrals?\b/i],
  ["beige", /\bbeige\b/i],
  ["cream", /\b(?:cream|ivory|off-?white)\b/i],
  ["grey", /\b(?:grey|gray)\b/i],
  ["white", /\bwhite\b/i]
];
const ACCENT_COLOURS: [string, RegExp][] = [
  ["dark blue", /\bdark\s+blue\b/i],
  ["navy", /\b(?:dark\s+)?navy\b/i],
  ["blue", /\blight-blue\b|\bblue\b/i],
  ["green", /\b(?:green|light-green|olive|sage|forest)\b/i],
  ["teal", /\bteal\b/i],
  ["mustard", /\b(?:mustard|yellow|ochre)\b/i],
  ["rust", /\b(?:rust|terracotta|orange)\b/i],
  ["red", /\b(?:red|light-red|burgundy|wine)\b/i],
  ["violet", /\b(?:violet|light-violet|purple)\b/i],
  ["black", /\bblack\b/i]
];

/** Returns the colour names a phrase mentions; multiword names consume their words first. */
export function parseColours(text: string): { base: string[]; accent: string[] } {
  const base: string[] = [];
  const accent: string[] = [];
  let rest = text;
  for (const [name, re] of BASE_COLOURS) {
    if (re.test(rest)) {
      base.push(name);
      rest = rest.replace(new RegExp(re.source, "gi"), " ");
    }
  }
  for (const [name, re] of ACCENT_COLOURS) {
    if (re.test(rest)) {
      accent.push(name);
      rest = rest.replace(new RegExp(re.source, "gi"), " ");
    }
  }
  return { base, accent };
}

function unique<T>(list: T[]): T[] {
  return [...new Set(list)];
}

export function compileBoard(items: BoardItem[], options: { today?: string } = {}): CompiledSpec {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const spec: CompiledSpec = {
    room: null,
    room_name: null,
    budget: null,
    required_by: null,
    required_items: [],
    visual_direction: { base_colors: [], accent_colors: [] },
    layout_requirements: []
  };
  let rugGroup = false;
  for (const item of items) {
    const text = item.kind === "text" ? item.text : item.colour;
    const colours = parseColours(text);
    spec.visual_direction.base_colors.push(...colours.base);
    spec.visual_direction.accent_colors.push(...colours.accent);
    if (item.kind === "swatch") continue;

    if (!spec.room) spec.room = parseDimensions(text);
    if (!spec.room_name) {
      const name = ROOM_NAME.exec(text);
      if (name) spec.room_name = name[1].toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
    }
    if (!spec.budget) {
      const maximum = parseBudget(text);
      if (maximum != null) spec.budget = { maximum, currency: "USD" };
    }
    if (!spec.required_by) spec.required_by = parseRequiredDate(text, today);
    const found = parseItems(text);
    spec.required_items.push(...found);
    if (found.includes("rug") && RUG_GROUP.test(text)) rugGroup = true;
  }
  spec.required_items = unique(spec.required_items);
  spec.visual_direction.base_colors = unique(spec.visual_direction.base_colors);
  spec.visual_direction.accent_colors = unique(spec.visual_direction.accent_colors);
  if (rugGroup) spec.layout_requirements.push({ type: "rug_encompasses_group", items: ["sofa", "coffee_table"] });
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

/**
 * Reads the board items from a tldraw editor or store snapshot: note and text shapes become text
 * items; filled geo shapes become swatches named by their label, or by their tldraw colour when
 * the label is empty.
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
      items.push({ kind: "swatch", colour: label || record.props.color || "" });
    }
  }
  return items;
}
