import { describe, expect, it } from "vitest";
import { z } from "zod";
import { TOOLS, TOOLS_BY_NAME, TOOL_NAMES, resolveRoute, type ToolName } from "./tools";

/** One accepted and one rejected argument set per tool, checked against the JSON Schema. */
const EXAMPLES: Record<ToolName, { good: Record<string, unknown>; bad: Record<string, unknown> }> = {
  get_project_state: { good: {}, bad: { projectId: "p1" } },
  add_product: {
    good: { url: "https://shop.example/products/side-table", category: "side table", kind: "table" },
    bad: { url: "https://shop.example/products/lamp", category: "reading lamp", kind: "lamp" }
  },
  set_project_requirement: {
    good: { type: "room_dimensions", value: { width_mm: 3658, length_mm: 5486 } },
    bad: { type: "palette", value: ["dark blue"] }
  },
  update_bom: { good: { bomItemId: "b1", action: "approve" }, bad: { bomItemId: "b1", action: "delete" } },
  replace_bom_item: {
    good: { existingBomItemId: "b1", replacementProductId: "prod-2" },
    bad: { existingBomItemId: "b1" }
  },
  place_product: {
    good: { bomItemId: "b1", xMm: 400, yMm: 1200, rotationDeg: 90 },
    bad: { bomItemId: "b1", xMm: 400.5, yMm: -1, rotationDeg: 90 }
  },
  evaluate_project: { good: {}, bad: { verbose: true } }
};

describe("tool definitions", () => {
  it("cover exactly TOOL_NAMES in order", () => {
    expect(TOOLS.map((tool) => tool.name)).toEqual([...TOOL_NAMES]);
    expect(TOOLS_BY_NAME.size).toBe(TOOL_NAMES.length);
  });

  it("mark the two read tools read-only and the writes not", () => {
    const readOnly = TOOLS.filter((tool) => tool.annotations.readOnlyHint).map((tool) => tool.name);
    expect(readOnly).toEqual(["get_project_state", "evaluate_project"]);
  });

  it("describe every property and list every required property", () => {
    for (const tool of TOOLS) {
      const { properties, required = [] } = tool.inputSchema;
      for (const property of Object.values(properties)) {
        expect(property.description.length, tool.name).toBeGreaterThan(10);
      }
      for (const name of required) {
        expect(properties, `${tool.name}.${name}`).toHaveProperty(name);
      }
    }
  });

  it.each(TOOL_NAMES)("%s validates its good example and rejects its bad one", (name) => {
    const schema = z.fromJSONSchema(TOOLS_BY_NAME.get(name)!.inputSchema as z.core.JSONSchema.JSONSchema);
    expect(schema.safeParse(EXAMPLES[name].good).success).toBe(true);
    expect(schema.safeParse(EXAMPLES[name].bad).success).toBe(false);
  });

  it("route every tool under /api/projects/:projectId with a body for writes only", () => {
    for (const tool of TOOLS) {
      const route = resolveRoute(tool, EXAMPLES[tool.name].good);
      expect(route.path.startsWith("/api/projects/:projectId"), tool.name).toBe(true);
      expect(route.method === "GET", tool.name).toBe(tool.annotations.readOnlyHint);
      expect(route.body === undefined, tool.name).toBe(tool.annotations.readOnlyHint);
    }
  });
});
