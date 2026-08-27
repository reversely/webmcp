import { describe, expect, it } from "vitest";
import { collectBoardItems, compileBoard, parseBudget, parseDimensions, parseItems, parseLayoutRule, parseRequiredDate, richTextToPlain, type BoardItem } from "./compileBoard";

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

describe("parseItems", () => {
  it("keeps the board's own noun phrases and drops the lead-in and the tail", () => {
    expect(parseItems("Need sofa", TODAY)).toEqual(["sofa"]);
    expect(parseItems("big rug underneath everything", TODAY)).toEqual(["big rug"]);
    expect(parseItems("a couch and an end table, no ottoman", TODAY)).toEqual(["couch", "end table"]);
    expect(parseItems("reading chair", TODAY)).toEqual(["reading chair"]);
    expect(parseItems("2 standing desks", TODAY)).toEqual(["standing desks"]);
  });

  it("skips lines the fixed fields carry and long sentences", () => {
    expect(parseItems("12 × 18 living room", TODAY)).toEqual([]);
    expect(parseItems("$2500 max", TODAY)).toEqual([]);
    expect(parseItems("Need Sept 15", TODAY)).toEqual([]);
    expect(parseItems("we should probably keep the walls as they are today", TODAY)).toEqual([]);
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
    { kind: "swatch", colour: "#f76707" },
    { kind: "swatch", colour: "#4263eb" }
  ];

  it("compiles the PRD 16 demo board", () => {
    expect(compileBoard(demo, { today: TODAY })).toEqual({
      room: { width_ft: 12, length_ft: 18 },
      room_name: "Living room",
      budget: { maximum: 2500, currency: "USD" },
      required_by: "2026-09-15",
      required_items: ["sofa", "Coffee table", "Ottoman", "big rug"],
      swatches: [
        { hex: "#f76707", tag: "base" },
        { hex: "#4263eb", tag: "accent" }
      ],
      layout_rules: ["big rug underneath everything"]
    });
  });

  it("reads a layout sentence into a relation between the board's items", () => {
    const items = ["sofa", "Coffee table", "Ottoman", "big rug"];
    expect(parseLayoutRule("big rug underneath everything", items)).toEqual({ relation: "under", subject: "big rug", objects: ["sofa", "Coffee table", "Ottoman"] });
    expect(parseLayoutRule("the sofa against the long wall", items)).toEqual({ relation: "against_wall", subject: "sofa", objects: [] });
    expect(parseLayoutRule("keep 3 ft clear around the coffee table", items)).toEqual({ relation: "clear_around", subject: "Coffee table", objects: [] });
    expect(parseLayoutRule("sofa facing the window and the fireplace", items)).toEqual({ relation: "facing", subject: "sofa", objects: ["window", "fireplace"] });
    expect(parseLayoutRule("keep it cosy", items)).toEqual({ relation: "text", text: "keep it cosy" });
  });

  it("takes colours from swatches only and dedupes items case-insensitively", () => {
    const spec = compileBoard([text("Sofa"), text("sofa"), text("beige and cream base, dark blue accents"), { kind: "swatch", colour: "#ffffff" }], { today: TODAY });
    expect(spec.required_items).toEqual(["Sofa", "beige", "cream base", "dark blue accents"]);
    expect(spec.swatches).toEqual([{ hex: "#ffffff", tag: "base" }]);
    expect(spec.layout_rules).toEqual([]);
  });

  it("returns nulls for anything the board does not say", () => {
    const spec = compileBoard([text("Need sofa")], { today: TODAY });
    expect(spec.room).toBeNull();
    expect(spec.budget).toBeNull();
    expect(spec.required_by).toBeNull();
    expect(spec.swatches).toEqual([]);
  });
});

describe("collectBoardItems", () => {
  const para = (t: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });

  it("flattens rich text paragraphs", () => {
    expect(richTextToPlain({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }, { type: "paragraph", content: [{ type: "text", text: "b" }] }] })).toBe("a\nb");
  });

  it("reads notes, text, and filled geo shapes as hex swatches from an editor snapshot", () => {
    const snapshot = {
      document: {
        store: {
          "shape:1": { typeName: "shape", type: "note", props: { richText: para("Need sofa") } },
          "shape:2": { typeName: "shape", type: "text", props: { richText: para("$2500 max") } },
          "shape:3": { typeName: "shape", type: "geo", props: { fill: "solid", color: "blue", richText: para("#1F2F4F") } },
          "shape:4": { typeName: "shape", type: "geo", props: { fill: "solid", color: "grey", richText: para("") } },
          "shape:5": { typeName: "shape", type: "geo", props: { fill: "none", color: "red", richText: para("") } },
          "page:1": { typeName: "page" }
        }
      }
    };
    expect(collectBoardItems(snapshot)).toEqual([
      { kind: "text", text: "Need sofa" },
      { kind: "text", text: "$2500 max" },
      { kind: "swatch", colour: "#1f2f4f" },
      { kind: "swatch", colour: "#9fa8b2" }
    ]);
  });
});

describe("rule sentences and item resolution", () => {
  it("adds only the rule's subject as an item and resolves objects to the named items", () => {
    const spec = compileBoard(
      [
        { kind: "text", text: "reading chair" },
        { kind: "text", text: "standing desk" },
        { kind: "text", text: "big rug under the desk and the chair" }
      ] as never,
      { today: "2026-08-28" }
    );
    expect(spec.required_items).toEqual(["reading chair", "standing desk", "big rug"]);
    expect(parseLayoutRule("big rug under the desk and the chair", spec.required_items)).toEqual({ relation: "under", subject: "big rug", objects: ["standing desk", "reading chair"] });
  });
});

describe("roomNameFrom", () => {
  it("takes the room name from the dimension note without a list of room types", () => {
    expect(compileBoard([{ kind: "text", text: "12 x 18 living room" }] as never, { today: "2026-08-28" }).room_name).toBe("Living room");
    expect(compileBoard([{ kind: "text", text: "4 by 6 metres attic studio" }] as never, { today: "2026-08-28" }).room_name).toBe("Attic studio");
    expect(compileBoard([{ kind: "text", text: "12 x 18" }] as never, { today: "2026-08-28" }).room_name).toBeNull();
  });
});

describe("item dedupe by phrase", () => {
  it("keeps the note's fuller phrase when a rule names its short form", () => {
    const spec = compileBoard(
      [{ kind: "text", text: "reading chair" }, { kind: "text", text: "floor lamp" }, { kind: "text", text: "lamp next to the chair" }] as never,
      { today: "2026-08-28" }
    );
    expect(spec.required_items).toEqual(["reading chair", "floor lamp"]);
  });
});
