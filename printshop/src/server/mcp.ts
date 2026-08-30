/**
 * The MCP endpoint (PRD Section 5): JSON-RPC over HTTP for any agent that presents a profile URL
 * in meta["ucp-agent"].profile, the way a Shopify shop asks. A caller's batches are the ones its
 * buyer email created, so get_batch, update_batch, order, approve, messages, and changes are
 * scoped by the email the call carries in `buyer.email` or in `meta.buyer_email`.
 */
import { approveProof, BadRequestError, batchView, changes, createBatch, listDesigns, NotFoundError, orderBatch, postMessage, quote, requireDesign, updateBatch, validate } from "./api";
import { TOOLS, type ToolArgs } from "../webmcp/tools";

export type RpcRequest = { jsonrpc?: string; id?: string | number | null; method: string; params?: Record<string, unknown> };
const text = (payload: unknown, isError = false) => (isError ? { content: [{ type: "text", text: JSON.stringify(payload) }], isError: true } : { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload });

async function dispatch(name: string, args: ToolArgs, email: string | null): Promise<unknown> {
  switch (name) {
    case "list_designs":
      return { designs: listDesigns({ format: args.format as string | undefined, max_unit_cents: args.max_unit_cents === undefined ? undefined : Number(args.max_unit_cents) }) };
    case "get_design":
      return requireDesign(String(args.design_id));
    case "quote_batch":
      return quote(args);
    case "validate_units":
      return validate(args);
    case "create_batch":
      return createBatch(args);
    case "get_batch":
      return batchView(String(args.batch_id), email);
    case "update_batch":
      return updateBatch(String(args.batch_id), email, { units: args.units });
    case "order_batch":
      return orderBatch(String(args.batch_id), email);
    case "approve_proof":
      return approveProof(String(args.batch_id), email);
    case "post_message":
      return postMessage(String(args.batch_id), email, { text: args.text, from: "buyer" });
    case "get_changes":
      return changes(Number(args.since_seq ?? 0) || 0, email);
    default:
      throw new BadRequestError(`No operation for ${name}`);
  }
}

export async function handleRpc(rpc: RpcRequest): Promise<Record<string, unknown>> {
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: rpc.id ?? null, result });
  if (rpc.method === "initialize") return reply({ protocolVersion: "2025-06-18", serverInfo: { name: "printshop", version: "0.1.0" }, capabilities: { tools: {} } });
  if (rpc.method === "tools/list") return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
  if (rpc.method === "tools/call") {
    const name = String(rpc.params?.name ?? "");
    const args = ((rpc.params?.arguments as Record<string, unknown>) ?? {}) as ToolArgs;
    const meta = args.meta as { "ucp-agent"?: { profile?: string }; buyer_email?: string } | undefined;
    if (!meta?.["ucp-agent"]?.profile) return reply(text({ error: "meta.ucp-agent.profile is required" }, true));
    const email = (meta.buyer_email ?? (args.buyer as { email?: string } | undefined)?.email ?? null) as string | null;
    const { meta: _m, ...rest } = args;
    void _m;
    try {
      return reply(text(await dispatch(name, rest, email)));
    } catch (e) {
      if (e instanceof NotFoundError || e instanceof BadRequestError) return reply(text({ error: e.message }, true));
      throw e;
    }
  }
  return { jsonrpc: "2.0", id: rpc.id ?? null, error: { code: -32601, message: `Unknown method ${rpc.method}` } };
}
