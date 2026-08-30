/** Registers the template's tools on `document.modelContext`; aborting `signal` unregisters them. */
import { TOOLS, executeTool } from "./tools";

export type RegisterResult = { supported: false } | { supported: true; toolNames: string[] };

export async function registerTools(signal: AbortSignal): Promise<RegisterResult> {
  const modelContext = document.modelContext;
  if (!modelContext) return { supported: false };
  for (const tool of TOOLS) {
    await modelContext.registerTool(
      { name: tool.name, description: tool.description, inputSchema: tool.inputSchema, execute: async (args) => executeTool(tool, args as Record<string, unknown>) },
      { signal }
    );
  }
  return { supported: true, toolNames: TOOLS.map((t) => t.name) };
}
