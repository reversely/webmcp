import { beforeEach, describe, expect, it } from "vitest";
import { resetNotes } from "../notes/store";
import { TOOLS, executeTool } from "./tools";

const tool = (name: string) => TOOLS.find((t) => t.name === name)!;

describe("template tools", () => {
  beforeEach(resetNotes);

  it("add_note then list_notes round-trips through the page's store", () => {
    const added = executeTool(tool("add_note"), { text: "call the mover" });
    expect(added.isError).toBeUndefined();
    expect(JSON.parse(added.content[0].text)).toMatchObject({ id: 1, text: "call the mover" });
    const listed = executeTool(tool("list_notes"), {});
    expect(JSON.parse(listed.content[0].text)).toHaveLength(1);
  });

  it("an empty note is an error the agent can see", () => {
    const result = executeTool(tool("add_note"), { text: " " });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toMatch(/needs some text/);
  });

  it("every tool describes each property and declares required", () => {
    for (const t of TOOLS) {
      for (const p of Object.values(t.inputSchema.properties)) expect(p.description.length).toBeGreaterThan(0);
      expect(t.inputSchema.additionalProperties).toBe(false);
    }
  });
});
