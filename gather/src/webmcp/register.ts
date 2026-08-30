/**
 * Registers Gather's tools on `document.modelContext` and routes each call to the API with the
 * organizer's identity (the page's own session). A result is MCP-shaped: text content, isError on
 * a failed request. Aborting `signal` unregisters every tool.
 */
import { buildRequest, TOOLS, type ToolArgs, type ToolDefinition } from "./tools";

export interface ToolResult {
  content: [{ type: "text"; text: string }];
  isError?: true;
}
export type ToolCallEvent = { name: string; args: ToolArgs; result: ToolResult; ok: boolean; duration_ms: number };
export type RegisterResult = { supported: false } | { supported: true; toolNames: string[] };

function textResult(payload: unknown, isError: boolean): ToolResult {
  const result: ToolResult = { content: [{ type: "text", text: JSON.stringify(payload) }] };
  if (isError) result.isError = true;
  return result;
}

export async function executeThroughApi(tool: ToolDefinition, eventId: string, args: ToolArgs, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<ToolResult> {
  const { url, init } = buildRequest(tool, eventId, args ?? {});
  try {
    const response = await fetchImpl(url, { ...init, signal });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { message: text };
    }
    if (!response.ok) return textResult({ error: (body as { error?: string })?.error ?? response.statusText ?? `HTTP ${response.status}`, status: response.status }, true);
    return textResult(body, false);
  } catch (cause) {
    return textResult({ error: cause instanceof Error ? cause.message : String(cause) }, true);
  }
}

export async function registerGatherTools({ eventId, fetchImpl, signal, onToolCall }: { eventId: string; fetchImpl?: typeof fetch; signal: AbortSignal; onToolCall?: (event: ToolCallEvent) => void }): Promise<RegisterResult> {
  const modelContext = document.modelContext;
  if (!modelContext) return { supported: false };
  const doFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
  const organizerTools = TOOLS.filter((t) => t.scopes.includes("organizer"));
  for (const tool of organizerTools) {
    await modelContext.registerTool(
      {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        execute: async (args, options) => {
          const started = Date.now();
          const result = await executeThroughApi(tool, eventId, (args ?? {}) as ToolArgs, doFetch, options?.signal);
          onToolCall?.({ name: tool.name, args: (args ?? {}) as ToolArgs, result, ok: !result.isError, duration_ms: Date.now() - started });
          return result;
        }
      },
      { signal }
    );
  }
  return { supported: true, toolNames: organizerTools.map((t) => t.name) };
}
