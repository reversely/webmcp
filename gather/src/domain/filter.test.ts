import { describe, expect, it } from "vitest";
import { matches, parseFilter, type Subject } from "./filter";

const subject = (over: Partial<Subject["guest"]> = {}, values: Record<string, unknown> = {}, partySize = 2): Subject => ({
  guest: { id: "g1", event_id: "e", party_id: "p", role: "guest", status: "going", attendance: { seg_dinner: true }, display_name: "Ana", ...over },
  party: { id: "p", event_id: "e", guest_ids: Array.from({ length: partySize }, (_, i) => `g${i}`), contact: { email: null, phone: null }, plus_one_allowance: 0 },
  values
});

describe("the filter grammar", () => {
  it("reads structural paths and definition ids", () => {
    expect(matches([{ field: "status", op: "eq", value: "going" }], subject())).toBe(true);
    expect(matches([{ field: "role", op: "eq", value: "child" }], subject())).toBe(false);
    expect(matches([{ field: "attendance.seg_dinner", op: "eq", value: true }], subject())).toBe(true);
    expect(matches([{ field: "party.size", op: "gte", value: 2 }], subject())).toBe(true);
    expect(matches([{ field: "def_diet", op: "contains", value: "vegan" }], subject({}, { def_diet: ["vegan"] }))).toBe(true);
    expect(matches([{ field: "def_name", op: "missing" }], subject())).toBe(true);
    expect(matches([{ field: "def_name", op: "present" }], subject({}, { def_name: "Ana" }))).toBe(true);
  });
  it("combines clauses with AND and matches everyone on an empty filter", () => {
    expect(matches([{ field: "status", op: "eq", value: "going" }, { field: "role", op: "eq", value: "guest" }], subject())).toBe(true);
    expect(matches([{ field: "status", op: "eq", value: "going" }, { field: "role", op: "eq", value: "child" }], subject())).toBe(false);
    expect(matches([], subject())).toBe(true);
  });
  it("parses the query-string form and the JSON form, and names a bad clause", () => {
    expect(parseFilter("status:eq:going;party.size:gte:4")).toEqual([{ field: "status", op: "eq", value: "going" }, { field: "party.size", op: "gte", value: 4 }]);
    expect(parseFilter("status:in:going,maybe")).toEqual([{ field: "status", op: "in", value: ["going", "maybe"] }]);
    expect(parseFilter('[{"field":"status","op":"eq","value":"going"}]')).toEqual([{ field: "status", op: "eq", value: "going" }]);
    expect(parseFilter(undefined)).toEqual([]);
    expect(() => parseFilter("status:like:going")).toThrow(/clause 1 needs field:op/);
  });
});
