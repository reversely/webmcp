/**
 * JSON-RPC client for Shopify's catalog MCP endpoints. Every `tools/call` carries the agent
 * profile URL in `arguments.meta["ucp-agent"].profile` and needs no API key.
 */
import { z } from "zod";
import {
  CatalogError,
  GetProductResult,
  LookupCatalogResult,
  SearchCatalogResult,
  type GetProductOptions,
  type LookupOptions,
  type SearchCatalogParams
} from "./types";

export const GLOBAL_CATALOG_ENDPOINT = "https://catalog.shopify.com/api/ucp/mcp";
export const DEFAULT_AGENT_PROFILE_URL = "https://shopify.dev/ucp/agent-profiles/2026-04-08/valid-with-capabilities.json";
/** Upper bound the catalog accepts for `pagination.limit` and `lookup_catalog` ids. */
export const MAX_PAGE_SIZE = 50;

export function storefrontEndpoint(shopHost: string): string {
  return `https://${shopHost}/api/ucp/mcp`;
}

/** One `tools/call` about to be sent; `run` performs it. The hook may observe, time, or wrap it. */
export type CatalogCall = { endpoint: string; tool: string; args: Record<string, unknown> };
export type CatalogCallHook = <T>(call: CatalogCall, run: () => Promise<T>) => Promise<T>;

export interface CatalogClientOptions {
  endpoint?: string;
  profileUrl?: string;
  fetchImpl?: typeof fetch;
  /** Wraps every call, including those of clients derived with `withEndpoint`; used for tracing. */
  onCall?: CatalogCallHook;
}

export interface CatalogClient {
  readonly endpoint: string;
  readonly profileUrl: string;
  searchCatalog(params: SearchCatalogParams): Promise<SearchCatalogResult>;
  lookupCatalog(ids: string[], options?: LookupOptions): Promise<LookupCatalogResult>;
  getProduct(id: string, options?: GetProductOptions): Promise<GetProductResult>;
  /**
   * Any tool by name, with `args` spread beside `meta` in `arguments` (a cart tool takes
   * `{ cart }` or `{ id }`, a catalog tool `{ catalog }`). The reply is checked against `schema`
   * when one is given and returned as is otherwise.
   */
  callTool<T = unknown>(name: string, args: Record<string, unknown>, schema?: z.ZodType<T>): Promise<T>;
  /** The same profile and fetch against another endpoint, e.g. a merchant's storefront. */
  withEndpoint(endpoint: string): CatalogClient;
}

export function catalogClient(options: CatalogClientOptions = {}): CatalogClient {
  const endpoint = options.endpoint ?? GLOBAL_CATALOG_ENDPOINT;
  const profileUrl = options.profileUrl ?? DEFAULT_AGENT_PROFILE_URL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const onCall = options.onCall;
  let nextId = 1;

  /** `hookArgs` is what the tracing hook sees: a catalog tool's own payload rather than its `{ catalog }` wrapper. */
  function call<T extends z.ZodType>(tool: string, args: Record<string, unknown>, schema: T, hookArgs: Record<string, unknown> = args): Promise<z.infer<T>> {
    const run = () => send(tool, args, schema);
    return onCall ? onCall({ endpoint, tool, args: hookArgs }, run) : run();
  }

  function catalogCall<T extends z.ZodType>(tool: string, catalog: Record<string, unknown>, schema: T): Promise<z.infer<T>> {
    return call(tool, { catalog }, schema, catalog);
  }

  async function send<T extends z.ZodType>(tool: string, args: Record<string, unknown>, schema: T): Promise<z.infer<T>> {
    const body = {
      jsonrpc: "2.0",
      id: nextId++,
      method: "tools/call",
      params: { name: tool, arguments: { meta: { "ucp-agent": { profile: profileUrl } }, ...args } }
    };
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new CatalogError("http", `${tool}: HTTP ${response.status} from ${endpoint}`, { code: response.status });
    }
    return parseToolResult(await response.json(), schema);
  }

  return {
    endpoint,
    profileUrl,
    searchCatalog(params) {
      const limit = params.pagination?.limit;
      if (limit !== undefined && (limit < 1 || limit > MAX_PAGE_SIZE)) {
        throw new RangeError(`pagination.limit must be between 1 and ${MAX_PAGE_SIZE}, got ${limit}`);
      }
      return catalogCall("search_catalog", { ...params }, SearchCatalogResult);
    },
    lookupCatalog(ids, lookupOptions = {}) {
      if (ids.length < 1 || ids.length > MAX_PAGE_SIZE) {
        throw new RangeError(`lookup_catalog takes 1 to ${MAX_PAGE_SIZE} ids, got ${ids.length}`);
      }
      return catalogCall("lookup_catalog", { ids, ...lookupOptions }, LookupCatalogResult);
    },
    getProduct(id, productOptions = {}) {
      return catalogCall("get_product", { id, ...productOptions }, GetProductResult);
    },
    callTool<T>(name: string, args: Record<string, unknown>, schema?: z.ZodType<T>) {
      return call(name, args, schema ?? (z.unknown() as z.ZodType<T>));
    },
    withEndpoint(other) {
      return catalogClient({ endpoint: other, profileUrl, fetchImpl, onCall });
    }
  };
}

interface RpcEnvelope {
  error?: { code?: number; message?: string; data?: unknown };
  result?: {
    isError?: boolean;
    content?: { type?: string; text?: string }[];
    structuredContent?: unknown;
  };
}

/**
 * Unwraps a JSON-RPC `tools/call` envelope into the tool's payload.
 *
 * The payload sits as a JSON string in `result.content[0].text`; the Global Catalog omits
 * `content` and returns only `structuredContent`, so that is the fallback.
 *
 * Raises:
 *   CatalogError: on an RPC `error`, a `result.isError` tool failure, or a payload that does
 *     not match `schema`.
 */
export function parseToolResult<T extends z.ZodType>(envelope: unknown, schema: T): z.infer<T> {
  const { error, result } = (envelope ?? {}) as RpcEnvelope;
  if (error) {
    throw new CatalogError("rpc", error.message ?? "JSON-RPC error", { code: error.code, data: error.data });
  }
  if (!result) throw new CatalogError("malformed", "response has neither result nor error", { data: envelope });

  const text = result.content?.find((block) => typeof block.text === "string")?.text;
  if (result.isError) {
    throw new CatalogError("tool", text ?? "tool call failed", { data: result.structuredContent ?? text });
  }

  const payload = text !== undefined ? parseJsonText(text) : result.structuredContent;
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new CatalogError("malformed", `unexpected tool result: ${parsed.error.message}`, { data: payload });
  }
  return parsed.data;
}

function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new CatalogError("malformed", `tool result is not JSON: ${text.slice(0, 200)}`, { data: text });
  }
}
