/**
 * Gather's MCP endpoint (PRD Sections 7, 8, 12): the same tool list the page registers, served
 * over HTTP as JSON-RPC to token holders. A token is a row naming who may call which tools on
 * which gifts and read which definitions; every call checks it. Results are MCP-shaped: text
 * content, isError on a refusal or a failure. Nothing here spends money for a vendor token.
 */
import { z } from "zod";
import { readLatestSeq } from "./seq";
import { changes, counts, guestList, guestView, manifestView, missing, postUpdate, setPersonalizationMappings, summary, updateGiftFromBody, updatesFor, readFilter, requireEvent, BadRequestError, NotFoundError } from "./api";
import { newId, state } from "../domain/store";
import { LockedValueError } from "../domain/store";
import type { CallerToken } from "../domain/types";
import { TOOLS, type ToolArgs, type ToolDefinition } from "../webmcp/tools";
import { cartOperations } from "./registry";
import "./cart-api";

export type McpResult = { content: [{ type: "text"; text: string }]; isError?: true };
const text = (payload: unknown, isError = false): McpResult => (isError ? { content: [{ type: "text", text: JSON.stringify(payload) }], isError: true } : { content: [{ type: "text", text: JSON.stringify(payload) }] });

/* ---- Tokens ---- */

export const TokenBody = z.object({
  holder: z.string().min(1),
  gift_ids: z.array(z.string()).default([]),
  readable_definition_ids: z.array(z.string()).default([]),
  callable_tools: z.array(z.string()).default([]),
  expires_at: z.string().nullable().default(null)
});

/** Creates a token for one holder. The organizer's own token lists every tool; a vendor's lists the vendor-scoped ones it needs. */
export function createToken(eventId: string, body: unknown): CallerToken {
  requireEvent(eventId);
  const parsed = TokenBody.safeParse(body);
  if (!parsed.success) throw new BadRequestError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const unknownTools = parsed.data.callable_tools.filter((t) => !TOOLS.some((x) => x.name === t));
  if (unknownTools.length) throw new BadRequestError(`Unknown tools: ${unknownTools.join(", ")}.`);
  const token: CallerToken = { id: newId("tok"), event_id: eventId, ...parsed.data, last_profile_url: null };
  state().tokens.set(token.id, token);
  return token;
}

export function tokensFor(eventId: string): CallerToken[] {
  return [...state().tokens.values()].filter((t) => t.event_id === eventId);
}

/** Reads the bearer token from the request and checks it belongs to the event and has not expired. */
export function tokenFrom(eventId: string, request: Request): CallerToken | null {
  const header = request.headers.get("authorization") ?? "";
  const id = header.replace(/^Bearer\s+/i, "").trim();
  if (!id) return null;
  const token = state().tokens.get(id);
  if (!token || token.event_id !== eventId) return null;
  if (token.expires_at && Date.parse(token.expires_at) < Date.now()) return null;
  return token;
}

function allowed(token: CallerToken, tool: ToolDefinition): boolean {
  return token.callable_tools.includes(tool.name);
}

/* ---- The dispatch: each tool runs the operation its page route runs, under the token's scope ---- */

function requireGiftScope(token: CallerToken, giftId: string) {
  if (!token.gift_ids.includes(giftId)) throw new NotFoundError(`No gift ${giftId} for this token.`);
}

function readable(token: CallerToken, fields: string[] | undefined): string[] {
  return fields?.length ? fields.filter((f) => token.readable_definition_ids.includes(f)) : token.readable_definition_ids;
}

function filterValues<T extends { values?: Record<string, unknown> }>(row: T, ids: string[]): T {
  if (!row.values) return row;
  return { ...row, values: Object.fromEntries(Object.entries(row.values).filter(([k]) => ids.includes(k))) };
}

type PersonalizedRow = { personalization?: Record<string, { source?: { type?: string; definition_id?: string } }> };

/** Drops the personalization entries whose source definition the token may not read, mirroring filterValues (#117). */
function filterPersonalization<T extends PersonalizedRow>(row: T, ids: string[]): T {
  if (!row.personalization) return row;
  return { ...row, personalization: Object.fromEntries(Object.entries(row.personalization).filter(([, v]) => v.source?.type !== "definition" || ids.includes(v.source.definition_id ?? ""))) };
}

/** The definition ids a mappings argument names, read loosely before validation. */
function mappingDefinitionIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((m) => {
    const source = (m as { source?: { type?: string; definition_id?: string } } | null)?.source;
    return source?.type === "definition" && source.definition_id ? [source.definition_id] : [];
  });
}

async function dispatch(eventId: string, token: CallerToken, tool: ToolDefinition, args: ToolArgs): Promise<unknown> {
  const organizer = token.callable_tools.includes("set_gift_plan");
  const strArg = (k: string) => (args[k] === undefined || args[k] === null ? undefined : String(args[k]));
  const fields = Array.isArray(args.fields) ? (args.fields as string[]) : undefined;
  switch (tool.name) {
    case "get_guest": {
      const row = guestView(eventId, String(args.guest_id), fields);
      return organizer ? row : filterValues(row, readable(token, fields));
    }
    case "list_guests": {
      const rows = guestList(eventId, readFilter(strArg("filter")), fields);
      return { guests: organizer ? rows : rows.map((r) => filterValues(r, readable(token, fields))) };
    }
    case "count_by": {
      const definitionId = String(args.definition_id);
      if (!organizer && !token.readable_definition_ids.includes(definitionId)) throw new NotFoundError(`No definition ${definitionId} for this token.`);
      return counts(eventId, definitionId, readFilter(strArg("filter")));
    }
    case "list_missing":
      return missing(eventId, String(args.definition_id), readFilter(strArg("filter")));
    case "get_summary": {
      const ids = Array.isArray(args.definition_ids) ? (args.definition_ids as string[]) : [];
      return summary(eventId, organizer ? ids : readable(token, ids), readFilter(strArg("filter")));
    }
    case "get_manifest": {
      const giftId = String(args.gift_id);
      if (!organizer) requireGiftScope(token, giftId);
      const view = manifestView(eventId, giftId) as { rows?: ({ values?: Record<string, unknown> } & PersonalizedRow)[] } & Record<string, unknown>;
      if (organizer) return view;
      const ids = token.readable_definition_ids;
      return { ...view, rows: (view.rows ?? []).map((r) => filterPersonalization(filterValues(r, ids), ids)) };
    }
    case "get_changes": {
      const since = Number(args.since_seq ?? 0);
      const all = changes(eventId, Number.isNaN(since) ? 0 : since);
      if (organizer) return all;
      const entries = all.entries.filter((e) => (e.kind === "value" ? token.readable_definition_ids.includes(e.definition_id) : e.kind === "status" ? true : token.gift_ids.includes(e.gift_id)));
      return { ...all, entries };
    }
    case "set_gift_plan":
      return updateGiftFromBody(eventId, String(args.gift_id), { rules: args.rules });
    case "set_personalization_mapping": {
      const giftId = String(args.gift_id);
      if (!organizer) {
        requireGiftScope(token, giftId);
        for (const id of mappingDefinitionIds(args.mappings)) if (!token.readable_definition_ids.includes(id)) throw new NotFoundError(`No definition ${id} for this token.`);
      }
      return setPersonalizationMappings(eventId, giftId, { mappings: args.mappings });
    }
    case "post_update": {
      const giftId = String(args.gift_id);
      if (!organizer) requireGiftScope(token, giftId);
      return postUpdate(eventId, giftId, organizer ? "organizer" : `token:${token.id}`, { kind: args.kind, text: args.text ?? "", expected_date: args.expected_date ?? null, reference: args.reference ?? null, guest_id: args.guest_id ?? null });
    }
    case "get_updates": {
      const giftId = String(args.gift_id);
      if (!organizer) requireGiftScope(token, giftId);
      return { updates: updatesFor(eventId, giftId, Number(args.since_seq ?? 0) || 0) };
    }
    case "search_gifts":
      return searchOperation(eventId, args);
    case "send_to_vendor":
    case "approve":
      return cartOperation(eventId, tool.name, String(args.gift_id));
    default:
      throw new BadRequestError(`No operation for ${tool.name}.`);
  }
}

async function cartOperation(eventId: string, name: string, giftId: string): Promise<unknown> {
  const fn = name === "send_to_vendor" ? cartOperations.send : cartOperations.approve;
  if (!fn) throw new BadRequestError(`${name} is not available on this build.`);
  return fn(eventId, giftId);
}

/** The search runs through the same route handler the page calls, so an agent and the page see one result shape. */
async function searchOperation(eventId: string, args: ToolArgs): Promise<unknown> {
  const mod = await import("../app/api/events/[id]/search/route");
  const res = await mod.POST(new Request("http://gather.local/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ card: args.card, sentence: args.sentence }) }), { params: Promise.resolve({ id: eventId }) });
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new BadRequestError(String(body.error ?? "the search failed"));
  return body;
}

/* ---- JSON-RPC ---- */

export type RpcRequest = { jsonrpc?: string; id?: string | number | null; method: string; params?: Record<string, unknown> };

export async function handleRpc(eventId: string, token: CallerToken | null, rpc: RpcRequest): Promise<Record<string, unknown>> {
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: rpc.id ?? null, result });
  const error = (code: number, message: string) => ({ jsonrpc: "2.0", id: rpc.id ?? null, error: { code, message } });
  try {
    requireEvent(eventId);
  } catch {
    return error(-32004, `No event ${eventId}.`);
  }
  if (rpc.method === "initialize") return reply({ protocolVersion: "2025-06-18", serverInfo: { name: "gather", version: "0.1.0" }, capabilities: { tools: {} } });
  if (!token) return reply(text({ error: "A bearer token for this event is required." }, true));
  const visible = TOOLS.filter((t) => allowed(token, t));
  if (rpc.method === "tools/list") return reply({ tools: visible.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
  if (rpc.method === "tools/call") {
    const name = String(rpc.params?.name ?? "");
    const tool = visible.find((t) => t.name === name);
    if (!tool) return reply(text({ error: `The token may not call ${name || "an unnamed tool"}.` }, true));
    const args = ((rpc.params?.arguments as Record<string, unknown>) ?? {}) as ToolArgs;
    const profile = (args.meta as { "ucp-agent"?: { profile?: string } } | undefined)?.["ucp-agent"]?.profile;
    if (profile) state().tokens.set(token.id, { ...token, last_profile_url: profile });
    try {
      const result = await dispatch(eventId, token, tool, args);
      return reply({ ...text(result), structuredContent: result, seq: readLatestSeq() });
    } catch (e) {
      if (e instanceof NotFoundError || e instanceof BadRequestError || e instanceof LockedValueError) return reply(text({ error: e.message }, true));
      throw e;
    }
  }
  return error(-32601, `Unknown method ${rpc.method}.`);
}
