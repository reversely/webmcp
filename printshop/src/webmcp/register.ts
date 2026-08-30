/** Registers the shop's tools on `document.modelContext`; each call goes to the route its definition names. Aborting `signal` unregisters them. */
import { buildRequest, TOOLS, type ToolArgs } from "./tools";

export interface ToolResult { content: [{ type: "text"; text: string }]; isError?: true }
export type RegisterResult = { supported: false } | { supported: true; toolNames: string[] };

export async function executeThroughApi(name: string, args: ToolArgs, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<ToolResult> {
  const tool = TOOLS.find((t) => t.name === name)!;
  const { url, init } = buildRequest(tool, args ?? {});
  try {
    const res = await fetchImpl(url, { ...init, signal });
    const body = await res.text();
    let parsed: unknown = null;
    try {
      parsed = body ? JSON.parse(body) : null;
    } catch {
      parsed = { message: body };
    }
    if (!res.ok) return { content: [{ type: "text", text: JSON.stringify({ error: (parsed as { error?: string })?.error ?? res.statusText, status: res.status }) }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(parsed) }] };
  } catch (e) {
    return { content: [{ type: "text", text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }], isError: true };
  }
}

export async function registerShopTools(signal: AbortSignal, fetchImpl?: typeof fetch): Promise<RegisterResult> {
  const modelContext = document.modelContext;
  if (!modelContext) return { supported: false };
  for (const tool of TOOLS) {
    await modelContext.registerTool({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, execute: async (args, options) => executeThroughApi(tool.name, (args ?? {}) as ToolArgs, fetchImpl, options?.signal) }, { signal });
  }
  return { supported: true, toolNames: TOOLS.map((t) => t.name) };
}
