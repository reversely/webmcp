/** Printshop's tools as data (PRD Section 5): one definition per tool with the route it maps to; the page and the endpoint render the same list. */
export type ToolArgs = Record<string, unknown>;
export interface JsonSchemaProperty { type: "string" | "integer" | "number" | "boolean" | "object" | "array"; description: string; enum?: readonly string[]; items?: { type: string } }
export interface JsonObjectSchema { type: "object"; properties: Record<string, JsonSchemaProperty>; required?: string[]; additionalProperties: false }
export interface Route { method: "GET" | "POST" | "PATCH"; path: string; query?: (a: ToolArgs) => Record<string, string | undefined>; body?: (a: ToolArgs) => unknown }
export interface ToolDefinition { name: string; description: string; inputSchema: JsonObjectSchema; route: Route }

const str = (v: unknown) => (v === undefined || v === null ? undefined : String(v));
const ADDRESS = { type: "object", description: "The delivery address: name, line1, city, region, postal_code, country" } as const;
const UNITS = { type: "array", description: "One unit per recipient as { recipient_ref, values } where values holds the design's fields by key", items: { type: "object" } } as const;

export const TOOLS: ToolDefinition[] = [
  { name: "list_designs", description: "Lists the shop's designs with their price bands and lead times. Filter by format or by a unit price ceiling in cents.", inputSchema: { type: "object", properties: { format: { type: "string", description: "flat, folded, or tent" }, max_unit_cents: { type: "integer", description: "Only designs whose lowest band is at or under this unit price" } }, additionalProperties: false }, route: { method: "GET", path: "/api/designs", query: (a) => ({ format: str(a.format), max_unit_cents: str(a.max_unit_cents) }) } },
  { name: "get_design", description: "Returns one design with its personalization schema: the fields a unit carries and their limits.", inputSchema: { type: "object", properties: { design_id: { type: "string", description: "The design id" } }, required: ["design_id"], additionalProperties: false }, route: { method: "GET", path: "/api/designs/{design_id}" } },
  { name: "quote_batch", description: "Quotes a batch: the unit price at the quantity's band, tax, total, and the ready-by date, or a refusal naming the rule (minimum quantity, lead time, delivery country).", inputSchema: { type: "object", properties: { design_id: { type: "string", description: "The design id" }, quantity: { type: "integer", description: "Units" }, needed_by: { type: "string", description: "ISO date the batch must arrive by" }, address: ADDRESS }, required: ["design_id", "quantity", "needed_by", "address"], additionalProperties: false }, route: { method: "POST", path: "/api/quotes", body: (a) => ({ design_id: a.design_id, quantity: a.quantity, needed_by: a.needed_by, address: a.address }) } },
  { name: "validate_units", description: "Checks units against a design's fields and returns the issues: a missing required value, a value over its length, a bad monogram, an unknown field, a duplicate recipient.", inputSchema: { type: "object", properties: { design_id: { type: "string", description: "The design id" }, units: UNITS }, required: ["design_id", "units"], additionalProperties: false }, route: { method: "POST", path: "/api/validate", body: (a) => ({ design_id: a.design_id, units: a.units }) } },
  { name: "create_batch", description: "Creates a quoted batch from a design, the units, the address, the needed-by date, and the buyer. Nothing is ordered until order_batch.", inputSchema: { type: "object", properties: { design_id: { type: "string", description: "The design id" }, units: UNITS, address: ADDRESS, needed_by: { type: "string", description: "ISO date" }, buyer: { type: "object", description: "name, email, phone" } }, required: ["design_id", "units", "address", "needed_by", "buyer"], additionalProperties: false }, route: { method: "POST", path: "/api/batches", body: (a) => ({ design_id: a.design_id, units: a.units, address: a.address, needed_by: a.needed_by, buyer: a.buyer }) } },
  { name: "get_batch", description: "Returns a batch with its status, quote, proof, issues, and thread.", inputSchema: { type: "object", properties: { batch_id: { type: "string", description: "The batch id" } }, required: ["batch_id"], additionalProperties: false }, route: { method: "GET", path: "/api/batches/{batch_id}" } },
  { name: "update_batch", description: "Replaces a batch's units before it is ordered; the batch is re-quoted.", inputSchema: { type: "object", properties: { batch_id: { type: "string", description: "The batch id" }, units: UNITS }, required: ["batch_id", "units"], additionalProperties: false }, route: { method: "PATCH", path: "/api/batches/{batch_id}", body: (a) => ({ units: a.units }) } },
  { name: "order_batch", description: "Orders a quoted batch: the shop renders one proof per unit and posts proof ready into the thread.", inputSchema: { type: "object", properties: { batch_id: { type: "string", description: "The batch id" } }, required: ["batch_id"], additionalProperties: false }, route: { method: "POST", path: "/api/batches/{batch_id}/order" } },
  { name: "approve_proof", description: "Approves the proof; the shop starts printing and posts each stage with a reference.", inputSchema: { type: "object", properties: { batch_id: { type: "string", description: "The batch id" } }, required: ["batch_id"], additionalProperties: false }, route: { method: "POST", path: "/api/batches/{batch_id}/approve" } },
  { name: "post_message", description: "Posts a buyer's message into a batch's thread.", inputSchema: { type: "object", properties: { batch_id: { type: "string", description: "The batch id" }, text: { type: "string", description: "The message" } }, required: ["batch_id", "text"], additionalProperties: false }, route: { method: "POST", path: "/api/batches/{batch_id}/messages", body: (a) => ({ text: a.text }) } },
  { name: "get_changes", description: "Returns every batch event after a sequence number: quotes, orders, proofs, stages, messages.", inputSchema: { type: "object", properties: { since_seq: { type: "integer", description: "The last sequence number seen; 0 for everything" } }, required: ["since_seq"], additionalProperties: false }, route: { method: "GET", path: "/api/changes", query: (a) => ({ since: str(a.since_seq ?? 0) }) } }
];

export function buildRequest(tool: ToolDefinition, args: ToolArgs): { url: string; init: RequestInit } {
  let path = tool.route.path.replace(/\{(\w+)\}/g, (_, key: string) => encodeURIComponent(String(args[key] ?? "")));
  const init: RequestInit = { method: tool.route.method, headers: { Accept: "application/json" } };
  if (tool.route.query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(tool.route.query(args))) if (v !== undefined && v !== "") params.set(k, v);
    const qs = params.toString();
    if (qs) path += `?${qs}`;
  }
  if (tool.route.body) {
    init.headers = { ...init.headers, "Content-Type": "application/json" };
    init.body = JSON.stringify(tool.route.body(args));
  }
  return { url: path, init };
}

export function toolsSchemaJson(): { name: string; description: string; inputSchema: object }[] {
  return TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}
