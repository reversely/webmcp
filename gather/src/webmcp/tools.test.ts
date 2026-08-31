import { describe, expect, it } from "vitest";
import { buildRequest, TOOLS, toolsSchemaJson } from "./tools";

const tool = (name: string) => TOOLS.find((t) => t.name === name)!;

describe("the tool definitions", () => {
  it("describe every property, declare additionalProperties false, and name a scope", () => {
    for (const t of TOOLS) {
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.inputSchema.additionalProperties).toBe(false);
      for (const p of Object.values(t.inputSchema.properties)) expect(p.description.length).toBeGreaterThan(0);
      expect(t.scopes.length).toBeGreaterThan(0);
    }
    expect(toolsSchemaJson().map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
  });
  it("builds a GET with the filter and fields as query parameters", () => {
    const { url, init } = buildRequest(tool("list_guests"), "evt_1", { filter: "status:eq:going", fields: ["def_1", "def_2"] });
    expect(url).toBe("/api/events/evt_1/guests?filter=status%3Aeq%3Agoing&fields=def_1%2Cdef_2");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });
  it("substitutes path arguments and builds a JSON body for a write", () => {
    const { url, init } = buildRequest(tool("post_update"), "evt_1", { gift_id: "gift_9", kind: "confirmed", text: "Confirmed." });
    expect(url).toBe("/api/events/evt_1/gifts/gift_9/updates");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ kind: "confirmed", text: "Confirmed.", expected_date: null, reference: null, guest_id: null });
  });
  it("keeps the money-spending tools away from vendor scope", () => {
    for (const name of ["set_gift_plan", "set_personalization_mapping", "send_to_vendor", "approve", "list_guests", "get_guest", "list_missing", "search_gifts"]) expect(tool(name).scopes).toEqual(["organizer"]);
    for (const name of ["get_manifest", "get_changes", "post_update", "get_updates", "count_by", "get_summary"]) expect(tool(name).scopes).toContain("vendor");
  });
});
