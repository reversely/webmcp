import { describe, expect, it } from "vitest";
import { collectBoardItems, compileBoard, parseBudget, parseDimensions, parseRequiredDate, richTextToPlain, type BoardItem } from "./compileBoard";

const TODAY = "2026-08-27";
const text = (t: string): BoardItem => ({ kind: "text", text: t });

describe("parseDimensions", () => {
  it("reads plain, by, and feet-marked pairs as feet", () => {
    expect(parseDimensions("12 x 18 living room")).toEqual({ width_ft: 12, length_ft: 18 });
    expect(parseDimensions("12 by 18")).toEqual({ width_ft: 12, length_ft: 18 });
    expect(parseDimensions("12' × 18'")).toEqual({ width_ft: 12, length_ft: 18 });
    expect(parseDimensions("12 ft x 18 ft")).toEqual({ width_ft: 12, length_ft: 18 });
  });
  it("adds inches to feet", () => {
    expect(parseDimensions(`12'6" x 18'`)).toEqual({ width_ft: 12.5, length_ft: 18 });
    expect(parseDimensions("11 ft 3 in by 17 ft 9 in")).toEqual({ width_ft: 11.25, length_ft: 17.75 });
  });
  it("converts metres to feet", () => {
    expect(parseDimensions("3.6 m x 5.5 m")).toEqual({ width_ft: 11.81, length_ft: 18.04 });
    expect(parseDimensions("4 by 6 metres")).toEqual({ width_ft: 13.12, length_ft: 19.69 });
    expect(parseDimensions("4m × 6m")).toEqual({ width_ft: 13.12, length_ft: 19.69 });
  });
  it("ignores text without a pair", () => {
    expect(parseDimensions("$2500 max")).toBeNull();
    expect(parseDimensions("Need Sept 15")).toBeNull();
  });
});

describe("parseBudget", () => {
  it("reads dollar amounts with and without separators", () => {
    expect(parseBudget("$2500 max")).toBe(2500);
    expect(parseBudget("$2,500")).toBe(2500);
    expect(parseBudget("$ 2.5k")).toBe(2500);
    expect(parseBudget("budget of 3000")).toBe(3000);
    expect(parseBudget("about 1,800 dollars")).toBe(1800);
  });
  it("returns null without an amount", () => {
    expect(parseBudget("Need sofa")).toBeNull();
  });
});

describe("parseRequiredDate", () => {
  it("resolves month-day forms to the next occurrence", () => {
    expect(parseRequiredDate("Need Sept 15", TODAY)).toBe("2026-09-15");
    expect(parseRequiredDate("by September 15", TODAY)).toBe("2026-09-15");
    expect(parseRequiredDate("Sep. 15th", TODAY)).toBe("2026-09-15");
    expect(parseRequiredDate("15 September", TODAY)).toBe("2026-09-15");
    expect(parseRequiredDate("by March 1", TODAY)).toBe("2027-03-01");
  });
  it("keeps explicit years and ISO dates", () => {
    expect(parseRequiredDate("Sept 15, 2027", TODAY)).toBe("2027-09-15");
    expect(parseRequiredDate("2026-10-02", TODAY)).toBe("2026-10-02");
    expect(parseRequiredDate("9/15", TODAY)).toBe("2026-09-15");
  });
});

describe("compileBoard", () => {
  const demo: BoardItem[] = [
    text("12 × 18 living room"),
    text("Need sofa"),
    text("Coffee table"),
    text("Ottoman"),
    text("big rug underneath everything"),
    text("$2500 max"),
    text("Need Sept 15"),
    { kind: "swatch", colour: "warm brown" },
    { kind: "swatch", colour: "dark navy" }
  ];

  it("compiles the PRD 16 demo board", () => {
    expect(compileBoard(demo, { today: TODAY })).toEqual({
      room: { width_ft: 12, length_ft: 18 },
      room_name: "Living room",
      budget: { maximum: 2500, currency: "USD" },
      required_by: "2026-09-15",
      required_items: ["sofa", "coffee_table", "ottoman", "rug"],
      visual_direction: { base_colors: ["warm brown"], accent_colors: ["navy"] },
      layout_requirements: [{ type: "rug_encompasses_group", items: ["sofa", "coffee_table"] }]
    });
  });

  it("recognises item synonyms, negation, and colour words in text", () => {
    const spec = compileBoard([text("a couch and an end table, no ottoman"), text("beige and cream base, dark blue accents"), text("neutral walls")], { today: TODAY });
    expect(spec.required_items).toEqual(["sofa", "side_table"]);
    expect(spec.visual_direction).toEqual({ base_colors: ["beige", "cream", "neutral"], accent_colors: ["dark blue"] });
    expect(spec.layout_requirements).toEqual([]);
  });

  it("returns nulls for anything the board does not say", () => {
    const spec = compileBoard([text("Need sofa")], { today: TODAY });
    expect(spec.room).toBeNull();
    expect(spec.budget).toBeNull();
    expect(spec.required_by).toBeNull();
  });
});

describe("collectBoardItems", () => {
  const para = (t: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });

  it("flattens rich text paragraphs", () => {
    expect(richTextToPlain({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }, { type: "paragraph", content: [{ type: "text", text: "b" }] }] })).toBe("a\nb");
  });

  it("reads notes, text, and filled geo shapes from an editor snapshot", () => {
    const snapshot = {
      document: {
        store: {
          "shape:1": { typeName: "shape", type: "note", props: { richText: para("Need sofa") } },
          "shape:2": { typeName: "shape", type: "text", props: { richText: para("$2500 max") } },
          "shape:3": { typeName: "shape", type: "geo", props: { fill: "solid", color: "blue", richText: para("dark navy") } },
          "shape:4": { typeName: "shape", type: "geo", props: { fill: "solid", color: "grey", richText: para("") } },
          "shape:5": { typeName: "shape", type: "geo", props: { fill: "none", color: "red", richText: para("") } },
          "page:1": { typeName: "page" }
        }
      }
    };
    expect(collectBoardItems(snapshot)).toEqual([
      { kind: "text", text: "Need sofa" },
      { kind: "text", text: "$2500 max" },
      { kind: "swatch", colour: "dark navy" },
      { kind: "swatch", colour: "grey" }
    ]);
  });
});
