import { describe, expect, it } from "vitest";
import type { AttributeDefinition } from "./types";
import { aggregate, controlFor, validateValue } from "./values";

const def = (value_type: AttributeDefinition["value_type"], constraints: AttributeDefinition["constraints"] = {}): AttributeDefinition => ({ id: "d", event_id: "e", namespace: "organizer", key: "k", label: "Field", scope: "guest", value_type, constraints, default_visibility: [], required_rule: "always", creator: "test" });

describe("validateValue per value type", () => {
  it("text trims and checks max length and pattern", () => {
    expect(validateValue(def("text", { max_length: 5 }), "  Ana ")).toEqual({ ok: true, value: "Ana" });
    expect(validateValue(def("text", { max_length: 3 }), "Marcus")).toMatchObject({ ok: false, reason: expect.stringMatching(/allows 3 characters; this has 6/) });
    expect(validateValue(def("text", { pattern: "^[A-Z]" }), "ana")).toMatchObject({ ok: false });
    expect(validateValue(def("text"), 4)).toMatchObject({ ok: false, reason: "Field needs text." });
  });
  it("number parses strings and checks min and max", () => {
    expect(validateValue(def("number", { min: 1, max: 4 }), "3")).toEqual({ ok: true, value: 3 });
    expect(validateValue(def("number", { min: 1 }), 0)).toMatchObject({ ok: false, reason: "Field must be at least 1." });
    expect(validateValue(def("number"), "x")).toMatchObject({ ok: false });
  });
  it("boolean accepts true, false, and their strings", () => {
    expect(validateValue(def("boolean"), "true")).toEqual({ ok: true, value: true });
    expect(validateValue(def("boolean"), "yes")).toMatchObject({ ok: false });
  });
  it("enum and multi_enum read the options row", () => {
    const options = [{ value: "a", label: "Option A" }, { value: "none", label: "None" }];
    expect(validateValue(def("enum", { options }), "a")).toEqual({ ok: true, value: "a" });
    expect(validateValue(def("enum", { options }), "zzz")).toMatchObject({ ok: false, reason: "Field must be one of: a, none." });
    expect(validateValue(def("multi_enum", { options }), ["a", "a", "none"])).toEqual({ ok: true, value: ["a", "none"] });
    expect(validateValue(def("multi_enum", { options }), ["zzz"])).toMatchObject({ ok: false });
  });
  it("date, file, and reference check their forms", () => {
    expect(validateValue(def("date"), "2026-10-17")).toEqual({ ok: true, value: "2026-10-17" });
    expect(validateValue(def("date"), "Oct 17")).toMatchObject({ ok: false });
    expect(validateValue(def("file"), "https://x/y.png")).toMatchObject({ ok: true });
    expect(validateValue(def("file"), "y.png")).toMatchObject({ ok: false });
    expect(validateValue(def("reference"), " guest_4 ")).toEqual({ ok: true, value: "guest_4" });
    expect(validateValue(def("reference"), "")).toMatchObject({ ok: false });
  });
});

describe("aggregate per value type", () => {
  it("counts options for multi_enum and reports missing", () => {
    const options = [{ value: "a", label: "Option A" }, { value: "b", label: "Option B" }];
    const a = aggregate(def("multi_enum", { options }), [["a"], ["a", "b"], undefined, []]);
    expect(a).toMatchObject({ value_type: "multi_enum", missing: 1 });
    if (a.value_type !== "multi_enum") throw new Error();
    expect(a.counts.map((c) => [c.option.value, c.count])).toEqual([["a", 2], ["b", 1]]);
  });
  it("sums numbers into quartile buckets", () => {
    const a = aggregate(def("number"), [1, 2, 3, 4, 5, 6, 7, 8, undefined]);
    if (a.value_type !== "number") throw new Error();
    expect(a.sum).toBe(36);
    expect(a.count).toBe(8);
    expect(a.buckets).toHaveLength(4);
    expect(a.buckets.reduce((s, b) => s + b.count, 0)).toBe(8);
    expect(a.missing).toBe(1);
  });
  it("counts true and false for boolean, presence for text", () => {
    expect(aggregate(def("boolean"), [true, false, true, undefined])).toEqual({ value_type: "boolean", true: 2, false: 1, missing: 1 });
    expect(aggregate(def("text"), ["Ana", "", undefined])).toEqual({ value_type: "text", present: 1, missing: 2 });
  });
});

describe("controlFor", () => {
  it("picks the control from the type and the constraints", () => {
    expect(controlFor(def("text"))).toBe("text");
    expect(controlFor(def("text", { max_length: 400 }))).toBe("textarea");
    expect(controlFor(def("enum", { options: Array.from({ length: 8 }, (_, i) => ({ value: String(i), label: String(i) })) }))).toBe("select");
    expect(controlFor(def("multi_enum"))).toBe("checkboxes");
  });
});
