/**
 * Regex extraction of product dimensions from merchant text (tech specs, descriptions).
 *
 * Conventions:
 * - Output lengths are integer millimetres; `unit` is the unit the merchant wrote.
 * - Labelled measurements (`84" W`, `Depth: 36"`) win over position. Unlabelled chains read as
 *   W x D x H, or W x L for a two-item chain (a rug), where L maps to depth.
 * - A two-item match has no written height. Height comes from a separate "pile" measurement when
 *   the text carries one, else a nominal 10 mm, and `height_assumed` is true.
 */
import { MM_PER_FOOT, MM_PER_INCH } from "../types";

export type DimensionUnit = "in" | "ft" | "cm" | "mm";

export interface ParsedDimensions {
  width_mm: number;
  depth_mm: number;
  height_mm: number;
  unit: DimensionUnit;
  matchedText: string;
  height_assumed: boolean;
}

/** Height assigned to a two-dimension (flat) match with no pile measurement. */
export const FLAT_HEIGHT_MM = 10;

const MM_PER_UNIT: Record<DimensionUnit, number> = {
  in: MM_PER_INCH,
  ft: MM_PER_FOOT,
  cm: 10,
  mm: 1
};

type Axis = "width" | "depth" | "height" | "length";

const AXIS_BY_LABEL: Record<string, Axis> = {
  w: "width",
  width: "width",
  d: "depth",
  depth: "depth",
  h: "height",
  height: "height",
  l: "length",
  length: "length"
};

const NUMBER = String.raw`(?:\d+\s+\d+/\d+|\d+/\d+|\d+(?:\.\d+)?)`;
const UNIT = String.raw`(?:"|'|(?:inches|inch|in|feet|foot|ft|cm|mm)\.?(?![a-z]))`;
const LABEL = String.raw`(?:width|depth|height|length|w|d|h|l)`;
const PRE_LABEL = String.raw`(?:(?<![a-z])(?<pre>${LABEL})(?![a-z])\s*[:=]?\s*)?`;
// A trailing label stays on its own line and is not the pre-label of the next measurement.
const POST_LABEL = String.raw`(?: *(?<post>${LABEL})(?![a-z])(?!\s*[:=]?\s*\d))?`;
const FEET_INCHES = String.raw`(?<feet>\d+)\s*'\s*(?<inches>${NUMBER})\s*"`;
const PLAIN = String.raw`(?<num>${NUMBER})\s*(?<unit>${UNIT})?`;
const MEASUREMENT = `${PRE_LABEL}(?:${FEET_INCHES}|${PLAIN})${POST_LABEL}`;

const MEASUREMENT_RE = new RegExp(MEASUREMENT, "gi");
// Named groups cannot repeat inside one regex, so the chain pattern uses an anonymous copy of the
// measurement and the items are re-read from the chain span with MEASUREMENT_RE.
const ANONYMOUS_MEASUREMENT = MEASUREMENT.replace(/\(\?<[a-z]+>/g, "(?:");
const CHAIN_RE = new RegExp(
  `${ANONYMOUS_MEASUREMENT}(?:\\s*(?:x|by)\\s*${ANONYMOUS_MEASUREMENT}){1,2}(?:\\s*(?<tail>${UNIT}))?`,
  "gi"
);
const PILE_RE = new RegExp(String.raw`pile(?:\s*height)?\s*[:=]?\s*(?<num>${NUMBER})\s*(?<unit>${UNIT})`, "i");

interface Measurement {
  value: number;
  unit: DimensionUnit | null;
  axis: Axis | null;
  text: string;
}

export function parseDimensions(text: string): ParsedDimensions | null {
  const normalized = normalizeGlyphs(text);
  return parseChain(normalized) ?? parseLabelled(normalized);
}

/** Maps typographic quotes and the multiplication sign onto the ASCII forms the patterns expect. */
function normalizeGlyphs(text: string): string {
  return text
    .replace(/[″”“]/g, '"')
    .replace(/[′’‘]/g, "'")
    .replace(/[×✕]/g, "x")
    .replace(/[ \t]+/g, " ");
}

/** Reads `W x D x H` chains, labelled or positional, returning the first chain with a unit. */
function parseChain(text: string): ParsedDimensions | null {
  for (const chain of text.matchAll(CHAIN_RE)) {
    const items = readMeasurements(chain[0]);
    const unit = items.find((item) => item.unit)?.unit ?? toUnit(chain.groups?.tail);
    if (!unit) continue;
    const axes = items.some((item) => item.axis) ? byLabel(items) : byPosition(items);
    const result = build(axes, unit, chain[0], text);
    if (result) return result;
  }
  return null;
}

/** Reads labelled measurements scattered through the text, e.g. one per line. */
function parseLabelled(text: string): ParsedDimensions | null {
  const items = readMeasurements(text).filter((item) => item.axis);
  const unit = items.find((item) => item.unit)?.unit;
  if (!unit) return null;
  const axes = byLabel(items);
  const matched = items
    .filter((item) => axes.get(item.axis as Axis) === item)
    .map((item) => item.text.trim())
    .join("; ");
  return build(axes, unit, matched, text);
}

function readMeasurements(span: string): Measurement[] {
  const items: Measurement[] = [];
  for (const match of span.matchAll(MEASUREMENT_RE)) {
    const groups = match.groups ?? {};
    const label = groups.pre ?? groups.post;
    // Feet and inches are held as decimal feet so one factor converts them below.
    const value = groups.feet ? Number(groups.feet) + parseNumber(groups.inches) / 12 : parseNumber(groups.num);
    items.push({
      value,
      unit: groups.feet ? "ft" : toUnit(groups.unit),
      axis: label ? AXIS_BY_LABEL[label.toLowerCase()] : null,
      text: match[0]
    });
  }
  return items;
}

function byPosition(items: Measurement[]): Map<Axis, Measurement> {
  const axes = new Map<Axis, Measurement>();
  const order: Axis[] = ["width", "depth", "height"];
  items.slice(0, 3).forEach((item, index) => axes.set(order[index], item));
  return axes;
}

/**
 * Keeps the first measurement per label. `L` reads as depth (a rug's length runs front to back)
 * unless a separate depth is present, in which case it reads as width (a sofa's length runs across
 * its front) when no width is written.
 */
function byLabel(items: Measurement[]): Map<Axis, Measurement> {
  const axes = new Map<Axis, Measurement>();
  for (const item of items) {
    if (item.axis && !axes.has(item.axis)) axes.set(item.axis, item);
  }
  const length = axes.get("length");
  if (length) {
    if (!axes.has("depth")) axes.set("depth", length);
    else if (!axes.has("width")) axes.set("width", length);
    axes.delete("length");
  }
  return axes;
}

function build(axes: Map<Axis, Measurement>, unit: DimensionUnit, matchedText: string, fullText: string): ParsedDimensions | null {
  const width = axes.get("width");
  const depth = axes.get("depth");
  const height = axes.get("height");
  if (!width || !depth) return null;
  const base = {
    width_mm: toMm(width, unit),
    depth_mm: toMm(depth, unit),
    unit: width.unit ?? unit,
    matchedText: matchedText.trim()
  };
  if (height) return { ...base, height_mm: toMm(height, unit), height_assumed: false };
  const pile = fullText.match(PILE_RE);
  if (pile?.groups) {
    const pileUnit = toUnit(pile.groups.unit) as DimensionUnit;
    return {
      ...base,
      height_mm: Math.round(parseNumber(pile.groups.num) * MM_PER_UNIT[pileUnit]),
      matchedText: `${base.matchedText}; ${pile[0].trim()}`,
      height_assumed: true
    };
  }
  return { ...base, height_mm: FLAT_HEIGHT_MM, height_assumed: true };
}

function toMm(item: Measurement, fallback: DimensionUnit): number {
  return Math.round(item.value * MM_PER_UNIT[item.unit ?? fallback]);
}

/** Parses `35`, `35.5`, `1/2`, and `35 1/2`. */
function parseNumber(raw: string): number {
  const [whole, fraction] = raw.trim().split(/\s+/);
  if (fraction) return Number(whole) + parseFraction(fraction);
  return whole.includes("/") ? parseFraction(whole) : Number(whole);
}

function parseFraction(raw: string): number {
  const [numerator, denominator] = raw.split("/").map(Number);
  return numerator / denominator;
}

function toUnit(raw: string | undefined): DimensionUnit | null {
  if (!raw) return null;
  const token = raw.toLowerCase().replace(/\.$/, "");
  if (token === '"' || token.startsWith("in")) return "in";
  if (token === "'" || token === "ft" || token === "feet" || token === "foot") return "ft";
  if (token === "cm") return "cm";
  if (token === "mm") return "mm";
  return null;
}
