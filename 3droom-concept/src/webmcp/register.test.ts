// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerPlannerTools, toolsSchemaJson, type ToolResult } from "./register";
import { TOOL_NAMES } from "./tools";

const POLYFILL_SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "polyfill.js"), "utf8");

/** `executeTool` is in the explainer and the polyfill but not yet in webmcp-types 0.1.5. */
interface ExecutingModelContext extends WebMCP.ModelContext {
  executeTool(tool: WebMCP.RegisteredTool, args: unknown, options?: { signal?: AbortSignal }): Promise<unknown>;
}

function modelContext(): ExecutingModelContext {
  return document.modelContext as ExecutingModelContext;
}

// The polyfill is an IIFE over the window globals, so evaluating its source installs it on the
// jsdom window the same way a <script> tag would.
function loadPolyfill() {
  new Function(POLYFILL_SOURCE)();
}

function removePolyfill() {
  const win = window as Window & { __webmcp_registered_tools?: Map<string, unknown> };
  delete (document as { modelContext?: unknown }).modelContext;
  delete win.__webmcp_registered_tools;
}

interface RecordedCall {
  url: string;
  init: RequestInit;
}

function fakeFetch(status: number, body: unknown) {
  const calls: RecordedCall[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" }
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const SNAPSHOT = {
  project: {
    id: "p1",
    name: "Living room",
    budget_cents: 250000,
    currency: "USD",
    required_by: "2026-09-15",
    delivery_address_json: { line1: "1 Main St", city: "Austin", region: "TX", postal_code: "78701", country: "US", source: "given" }
  },
  space: { id: "s1", name: "Living room", width_mm: 3658, length_mm: 5486, height_mm: null },
  requirements: [
    { id: "r1", type: "required_item", value_json: "sofa", scope: "project", status: "agreed" },
    { id: "r2", type: "visual_direction", value_json: { base_colors: ["warm brown"] }, scope: "project", status: "superseded" }
  ],
  products: [
    { id: "prod-sofa", title: "Linen sofa", price_cents: 120000, description: "long merchant text" },
    { id: "prod-rug", title: "Wool rug", price_cents: 40000, description: "long merchant text" }
  ],
  bom: [
    { id: "b1", product_id: "prod-sofa", category: "sofa", quantity: 1, status: "approved", delivery_status: "confirmed" },
    { id: "b2", product_id: "prod-rug", category: "rug", quantity: 1, status: "removed" }
  ],
  budget: { committed_cents: 120000, state: "under" },
  unresolved_questions: ["Which wall does the sofa face?"]
};

async function executeRegistered(name: string, args: Record<string, unknown>, options?: { signal?: AbortSignal }) {
  const tools = await modelContext().getTools();
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`${name} is not registered`);
  return (await modelContext().executeTool(tool, args, options)) as ToolResult;
}

function parseText(result: ToolResult): Record<string, unknown> {
  return JSON.parse(result.content[0].text);
}

describe("registerPlannerTools without document.modelContext", () => {
  it("reports supported: false and does not throw", async () => {
    expect(document.modelContext).toBeUndefined();
    const result = await registerPlannerTools({ projectId: "p1", signal: new AbortController().signal });
    expect(result).toEqual({ supported: false });
  });
});

describe("registerPlannerTools with the polyfill", () => {
  let controller: AbortController;

  beforeEach(() => {
    loadPolyfill();
    controller = new AbortController();
  });

  afterEach(() => {
    controller.abort();
    removePolyfill();
  });

  it("registers exactly the seven planner tools with their schemas", async () => {
    const { fetchImpl } = fakeFetch(200, SNAPSHOT);
    const result = await registerPlannerTools({ projectId: "p1", fetchImpl, signal: controller.signal });
    expect(result).toEqual({ supported: true, toolNames: [...TOOL_NAMES] });

    const tools = await modelContext().getTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([...TOOL_NAMES].sort());
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(40);
      expect(tool.inputSchema).toMatchObject({ type: "object" });
    }
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    expect(byName.get("get_project_state")?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get("replace_bom_item")?.annotations?.readOnlyHint).toBe(false);
  });

  it("get_project_state issues GET /api/projects/p1 and returns the trimmed state", async () => {
    const { fetchImpl, calls } = fakeFetch(200, SNAPSHOT);
    await registerPlannerTools({ projectId: "p1", fetchImpl, signal: controller.signal });

    const result = await executeRegistered("get_project_state", {});

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/projects/p1");
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.body).toBeUndefined();

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    const summary = parseText(result);
    expect(summary).toEqual({
      project_id: "p1",
      name: "Living room",
      room: { name: "Living room", width_mm: 3658, length_mm: 5486, height_mm: null },
      requirements: [{ type: "required_item", value: "sofa", scope: "project", status: "agreed" }],
      budget: { limit_cents: 250000, currency: "USD", committed_cents: 120000, state: "under" },
      bom: [
        {
          id: "b1",
          category: "sofa",
          product_id: "prod-sofa",
          title: "Linen sofa",
          price_cents: 120000,
          quantity: 1,
          status: "approved",
          delivery_status: "confirmed"
        }
      ],
      delivery: { required_by: "2026-09-15", destination: { postal_code: "78701", country: "US" } },
      unresolved_questions: ["Which wall does the sofa face?"]
    });
    expect(result.content[0].text).not.toContain("long merchant text");
  });

  it("replace_bom_item posts the JSON body to /api/projects/p1/bom/replace", async () => {
    const { fetchImpl, calls } = fakeFetch(200, SNAPSHOT);
    await registerPlannerTools({ projectId: "p1", fetchImpl, signal: controller.signal });

    const result = await executeRegistered("replace_bom_item", {
      existingBomItemId: "b1",
      replacementProductId: "prod-cheaper"
    });

    expect(calls[0].url).toBe("/api/projects/p1/bom/replace");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      existingBomItemId: "b1",
      replacementProductId: "prod-cheaper"
    });
    expect(result.isError).toBeUndefined();
    const summary = parseText(result);
    expect(summary.budget).toEqual({ limit_cents: 250000, currency: "USD", committed_cents: 120000, state: "under" });
    expect((summary.bom as unknown[]).map((line) => (line as { status: string }).status)).toEqual(["approved", "removed"]);
  });

  it("set_project_requirement picks PATCH for budget and POST requirements for a required item", async () => {
    const { fetchImpl, calls } = fakeFetch(200, SNAPSHOT);
    await registerPlannerTools({ projectId: "p1", fetchImpl, signal: controller.signal });

    await executeRegistered("set_project_requirement", { type: "budget", value: 250000 });
    await executeRegistered("set_project_requirement", { type: "required_item", value: "rug" });

    expect(calls[0]).toMatchObject({ url: "/api/projects/p1", init: { method: "PATCH" } });
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ budget_cents: 250000 });
    expect(calls[1]).toMatchObject({ url: "/api/projects/p1/requirements", init: { method: "POST" } });
    expect(JSON.parse(calls[1].init.body as string)).toEqual({ type: "required_item", value: "rug", scope: "project" });
  });

  it("a 409 response yields isError with the server's message", async () => {
    const { fetchImpl } = fakeFetch(409, { message: "Project version changed; reload and retry." });
    await registerPlannerTools({ projectId: "p1", fetchImpl, signal: controller.signal });

    const result = await executeRegistered("update_bom", { bomItemId: "b1", action: "approve" });

    expect(result.isError).toBe(true);
    expect(parseText(result)).toEqual({ error: "Project version changed; reload and retry.", status: 409 });
  });

  it("a thrown fetch error yields isError instead of rejecting", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    await registerPlannerTools({ projectId: "p1", fetchImpl, signal: controller.signal });

    const result = await executeRegistered("evaluate_project", {});

    expect(result.isError).toBe(true);
    expect(parseText(result)).toEqual({ error: "Failed to fetch" });
  });

  it("forwards the caller's abort signal to fetch", async () => {
    const { fetchImpl, calls } = fakeFetch(200, SNAPSHOT);
    await registerPlannerTools({ projectId: "p1", fetchImpl, signal: controller.signal });
    const execution = new AbortController();

    // The polyfill's executeTool drops the options for imperative tools, so call the registered
    // execute directly, the way a native implementation would.
    const win = window as Window & { __webmcp_registered_tools?: Map<string, { _execute: Function }> };
    const registered = win.__webmcp_registered_tools!.get("get_project_state")!;
    await registered._execute({}, { signal: execution.signal });

    expect(calls[0].init.signal).toBe(execution.signal);
  });

  it("aborting the registration signal unregisters every tool", async () => {
    const { fetchImpl } = fakeFetch(200, SNAPSHOT);
    await registerPlannerTools({ projectId: "p1", fetchImpl, signal: controller.signal });
    expect(await modelContext().getTools()).toHaveLength(TOOL_NAMES.length);

    controller.abort();

    expect(await modelContext().getTools()).toHaveLength(0);
  });
});

describe("toolsSchemaJson", () => {
  it("emits name, description and inputSchema for each tool and nothing else", () => {
    const schema = toolsSchemaJson();
    expect(schema.map((entry) => entry.name)).toEqual([...TOOL_NAMES]);
    for (const entry of schema) {
      expect(Object.keys(entry).sort()).toEqual(["description", "inputSchema", "name"]);
    }
    expect(() => JSON.stringify(schema)).not.toThrow();
  });
});
