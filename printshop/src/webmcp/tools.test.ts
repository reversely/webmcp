import { describe, expect, it } from "vitest";
import { buildRequest, TOOLS } from "./tools";

describe("the tool definitions", () => {
  it("describe every property and build the routes", () => {
    for (const t of TOOLS) { expect(t.description.length).toBeGreaterThan(20); for (const p of Object.values(t.inputSchema.properties)) expect(p.description.length).toBeGreaterThan(0); }
    expect(buildRequest(TOOLS.find((t) => t.name === "get_design")!, { design_id: "d 1" }).url).toBe("/api/designs/d%201");
    const q = buildRequest(TOOLS.find((t) => t.name === "quote_batch")!, { design_id: "d", quantity: 10, needed_by: "2031-01-01", address: { country: "CA" } });
    expect(q.init.method).toBe("POST");
    expect(JSON.parse(String(q.init.body))).toMatchObject({ design_id: "d", quantity: 10 });
    expect(buildRequest(TOOLS.find((t) => t.name === "get_changes")!, { since_seq: 4 }).url).toBe("/api/changes?since=4");
  });
});
