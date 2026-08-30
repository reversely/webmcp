/**
 * Gather's tools as data (PRD Section 7): one definition per tool, with the API route it maps to.
 * register.ts renders the list onto `document.modelContext` in the organizer's page; the MCP
 * endpoint (#91) serves the same list over HTTP. The model sees only name, description, and
 * inputSchema, so those three carry the whole contract.
 */
export type ToolArgs = Record<string, unknown>;
export type Scope = "organizer" | "vendor";

export interface JsonSchemaProperty {
  type: "string" | "integer" | "number" | "boolean" | "object" | "array";
  description: string;
  enum?: readonly string[];
  items?: { type: string };
}
export interface JsonObjectSchema {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties: false;
}
export interface Route {
  method: "GET" | "POST" | "PUT" | "PATCH";
  /** Path template; `:eventId` and any argument in braces are substituted at call time. */
  path: string;
  /** Query parameters built from the arguments, for GET. */
  query?: (args: ToolArgs) => Record<string, string | undefined>;
  /** The JSON body built from the arguments, for writes. */
  body?: (args: ToolArgs) => unknown;
}
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonObjectSchema;
  scopes: Scope[];
  route: Route;
}

const FILTER = { type: "string", description: "A filter as field:op:value clauses joined by ';' (fields: status, role, attendance.<segment id>, party.size, or a definition id; ops: eq, neq, in, not_in, gt, gte, lt, lte, contains, present, missing). Empty means every guest." } as const;
const FIELDS = { type: "array", description: "Definition ids to include; empty means every value the caller may read.", items: { type: "string" } } as const;
const csv = (v: unknown) => (Array.isArray(v) ? v.map(String).join(",") : typeof v === "string" ? v : undefined);
const str = (v: unknown) => (v === undefined || v === null ? undefined : String(v));

export const TOOLS: ToolDefinition[] = [
  {
    name: "get_guest",
    description: "Returns one guest with their status and the answers the caller may read.",
    inputSchema: { type: "object", properties: { guest_id: { type: "string", description: "The guest's id" }, fields: FIELDS }, required: ["guest_id"], additionalProperties: false },
    scopes: ["organizer"],
    route: { method: "GET", path: "/api/events/:eventId/guests/{guest_id}", query: (a) => ({ fields: csv(a.fields) }) }
  },
  {
    name: "list_guests",
    description: "Lists the guests a filter matches with their status and answers. Use it to see who is going, who is a maybe, or who has a given value.",
    inputSchema: { type: "object", properties: { filter: FILTER, fields: FIELDS }, additionalProperties: false },
    scopes: ["organizer"],
    route: { method: "GET", path: "/api/events/:eventId/guests", query: (a) => ({ filter: str(a.filter), fields: csv(a.fields) }) }
  },
  {
    name: "count_by",
    description: "Counts guests by one question's answers: per choice for a choice question, sum and buckets for a number, true and false for yes or no. Use it before answering how many guests need each variant.",
    inputSchema: { type: "object", properties: { definition_id: { type: "string", description: "The question's definition id" }, filter: FILTER }, required: ["definition_id"], additionalProperties: false },
    scopes: ["organizer", "vendor"],
    route: { method: "GET", path: "/api/events/:eventId/counts", query: (a) => ({ definition: str(a.definition_id), filter: str(a.filter) }) }
  },
  {
    name: "list_missing",
    description: "Lists the guests a filter matches who have not answered one question. Use it to find who still needs to give a value.",
    inputSchema: { type: "object", properties: { definition_id: { type: "string", description: "The question's definition id" }, filter: FILTER }, required: ["definition_id"], additionalProperties: false },
    scopes: ["organizer"],
    route: { method: "GET", path: "/api/events/:eventId/missing", query: (a) => ({ definition: str(a.definition_id), filter: str(a.filter) }) }
  },
  {
    name: "get_summary",
    description: "Returns the status counts and count_by for several questions in one call. Use it first when a question needs the whole picture of the replies.",
    inputSchema: { type: "object", properties: { filter: FILTER, definition_ids: FIELDS }, additionalProperties: false },
    scopes: ["organizer", "vendor"],
    route: { method: "GET", path: "/api/events/:eventId/summary", query: (a) => ({ filter: str(a.filter), definitions: csv(a.definition_ids) }) }
  },
  {
    name: "get_manifest",
    description: "Returns one row per guest for a gift: product, variant, unit status, and the values the caller may read. A vendor reads its batch here.",
    inputSchema: { type: "object", properties: { gift_id: { type: "string", description: "The gift's id" } }, required: ["gift_id"], additionalProperties: false },
    scopes: ["organizer", "vendor"],
    route: { method: "GET", path: "/api/events/:eventId/gifts/{gift_id}/manifest" }
  },
  {
    name: "get_changes",
    description: "Returns the change log after a sequence number: value writes, status changes, and vendor updates. Call it with the last sequence number you saw to learn what changed.",
    inputSchema: { type: "object", properties: { since_seq: { type: "integer", description: "The last sequence number already seen; 0 for everything" } }, required: ["since_seq"], additionalProperties: false },
    scopes: ["organizer", "vendor"],
    route: { method: "GET", path: "/api/events/:eventId/changes", query: (a) => ({ since: str(a.since_seq ?? 0) }) }
  },
  {
    name: "set_gift_plan",
    description: "Replaces a gift's plan: the ordered rules that assign a product to guests by filter. The first rule whose filter matches a guest wins.",
    inputSchema: { type: "object", properties: { gift_id: { type: "string", description: "The gift's id" }, rules: { type: "array", description: "Rules as {filter, product_id} in order", items: { type: "object" } } }, required: ["gift_id", "rules"], additionalProperties: false },
    scopes: ["organizer"],
    route: { method: "PATCH", path: "/api/events/:eventId/gifts/{gift_id}", body: (a) => ({ rules: a.rules }) }
  },
  {
    name: "send_to_vendor",
    description: "Sends a gift to its vendor: builds the priced proposal (the cart at the shop) from the current quantities.",
    inputSchema: { type: "object", properties: { gift_id: { type: "string", description: "The gift's id" } }, required: ["gift_id"], additionalProperties: false },
    scopes: ["organizer"],
    route: { method: "POST", path: "/api/events/:eventId/gifts/{gift_id}/send" }
  },
  {
    name: "approve",
    description: "Approves a sent gift: the cart is kept and updated until the lock date, then checked out.",
    inputSchema: { type: "object", properties: { gift_id: { type: "string", description: "The gift's id" } }, required: ["gift_id"], additionalProperties: false },
    scopes: ["organizer"],
    route: { method: "POST", path: "/api/events/:eventId/gifts/{gift_id}/approve" }
  },
  {
    name: "post_update",
    description: "Posts into a gift's thread: a vendor's confirmation, progress, shipped notice with a reference, an issue naming a guest, a question, or a proof; the organizer's replies use kind reply.",
    inputSchema: {
      type: "object",
      properties: {
        gift_id: { type: "string", description: "The gift's id" },
        kind: { type: "string", description: "What the post is", enum: ["confirmed", "in_production", "shipped", "delivered", "issue", "question", "proof", "reply"] },
        text: { type: "string", description: "The message" },
        expected_date: { type: "string", description: "An ISO date the vendor expects, if any" },
        reference: { type: "string", description: "A tracking or order reference, if any" },
        guest_id: { type: "string", description: "The guest an issue is about, if any" }
      },
      required: ["gift_id", "kind", "text"],
      additionalProperties: false
    },
    scopes: ["organizer", "vendor"],
    route: { method: "POST", path: "/api/events/:eventId/gifts/{gift_id}/updates", body: (a) => ({ kind: a.kind, text: a.text, expected_date: a.expected_date ?? null, reference: a.reference ?? null, guest_id: a.guest_id ?? null }) }
  },
  {
    name: "get_updates",
    description: "Returns a gift's thread: every post by the vendor and the organizer, in order.",
    inputSchema: { type: "object", properties: { gift_id: { type: "string", description: "The gift's id" }, since_seq: { type: "integer", description: "Only posts after this sequence number; 0 for all" } }, required: ["gift_id"], additionalProperties: false },
    scopes: ["organizer", "vendor"],
    route: { method: "GET", path: "/api/events/:eventId/gifts/{gift_id}/updates", query: (a) => ({ since: str(a.since_seq ?? 0) }) }
  }
];

/** Builds the URL and init for one call: path arguments in braces, then the query or the body. */
export function buildRequest(tool: ToolDefinition, eventId: string, args: ToolArgs): { url: string; init: RequestInit } {
  let path = tool.route.path.replace(":eventId", encodeURIComponent(eventId));
  path = path.replace(/\{(\w+)\}/g, (_, key: string) => encodeURIComponent(String(args[key] ?? "")));
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

/** The static tool list in the shape `webmcp-evals local -t schema.json` reads. */
export function toolsSchemaJson(): { name: string; description: string; inputSchema: object }[] {
  return TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}
