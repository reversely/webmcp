/**
 * Registers the planner's tools on `document.modelContext` and routes each call to the API.
 *
 * The request building and result shaping are pure; `fetchImpl` is the only side effect, so a
 * test can pass a fake and assert the exact request.
 */
import { summarize } from "./summarize";
import { TOOLS, type ToolArgs, type ToolDefinition, resolveRoute } from "./tools";

/** One finished tool execution, for tracing; `result` is what the agent received. */
export type ToolCallEvent = { name: string; args: ToolArgs; result: ToolResult; ok: boolean; duration_ms: number };

export interface RegisterOptions {
  projectId: string;
  /** Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Aborting it unregisters every tool. */
  signal: AbortSignal;
  /** Called after every tool execution with its name, arguments, and result. */
  onToolCall?: (event: ToolCallEvent) => void;
}

export type RegisterResult = { supported: false } | { supported: true; toolNames: string[] };

export interface ToolResult {
  content: [{ type: "text"; text: string }];
  isError?: true;
}

export interface ToolRequest {
  url: string;
  init: RequestInit;
}

/** Builds the fetch call for one tool invocation. */
export function buildRequest(tool: ToolDefinition, projectId: string, args: ToolArgs): ToolRequest {
  const route = resolveRoute(tool, args);
  const url = route.path.replace(":projectId", encodeURIComponent(projectId));
  const init: RequestInit = { method: route.method, headers: { Accept: "application/json" } };
  if (route.body) {
    init.headers = { ...init.headers, "Content-Type": "application/json" };
    init.body = JSON.stringify(route.body(args));
  }
  return { url, init };
}

function textResult(payload: unknown, isError: boolean): ToolResult {
  const result: ToolResult = { content: [{ type: "text", text: JSON.stringify(payload) }] };
  if (isError) result.isError = true;
  return result;
}

/** Extracts the server's message from an error body; falls back to the HTTP status text. */
function errorMessage(body: unknown, response: Response): string {
  if (body && typeof body === "object") {
    const { message, error } = body as { message?: unknown; error?: unknown };
    if (typeof message === "string") return message;
    if (typeof error === "string") return error;
  }
  return response.statusText || `HTTP ${response.status}`;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

async function executeThroughApi(
  tool: ToolDefinition,
  projectId: string,
  fetchImpl: typeof fetch,
  args: ToolArgs,
  signal: AbortSignal | undefined
): Promise<ToolResult> {
  const { url, init } = buildRequest(tool, projectId, args ?? {});
  try {
    const response = await fetchImpl(url, { ...init, signal });
    const body = await readJson(response);
    if (!response.ok) {
      return textResult({ error: errorMessage(body, response), status: response.status }, true);
    }
    return textResult(summarize(tool.name, body), false);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return textResult({ error: message }, true);
  }
}

/**
 * Registers the seven planner tools, or reports `supported: false` when the page has no
 * `document.modelContext` (no native support and no polyfill loaded).
 */
export async function registerPlannerTools({ projectId, fetchImpl, signal, onToolCall }: RegisterOptions): Promise<RegisterResult> {
  const modelContext = document.modelContext;
  if (!modelContext) return { supported: false };
  const doFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
  const execute = async (tool: ToolDefinition, args: ToolArgs, abort: AbortSignal | undefined): Promise<ToolResult> => {
    const started = Date.now();
    const result = await executeThroughApi(tool, projectId, doFetch, args, abort);
    onToolCall?.({ name: tool.name, args: args ?? {}, result, ok: !result.isError, duration_ms: Date.now() - started });
    return result;
  };

  for (const tool of TOOLS) {
    await modelContext.registerTool(
      {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
        // The polyfill calls execute with a single argument, so the options default matters.
        execute: (args, options) => execute(tool, args, options?.signal)
      },
      { signal }
    );
  }
  return { supported: true, toolNames: TOOLS.map((tool) => tool.name) };
}

/** The static tool list in the shape `webmcp-evals local -t schema.json` reads. */
export function toolsSchemaJson(): { name: string; description: string; inputSchema: object }[] {
  return TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}
