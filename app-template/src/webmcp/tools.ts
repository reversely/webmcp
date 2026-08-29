/**
 * The two WebMCP tools of the template, as data plus the function each one runs. `register.ts`
 * turns these into `document.modelContext` registrations. The model sees only name, description,
 * and inputSchema, so those three carry the whole contract (webmcp skill, rule 2).
 */
import { addNote, listNotes } from "../notes/store";

export type ToolArgs = Record<string, unknown>;

export interface ToolResult {
  content: [{ type: "text"; text: string }];
  isError?: true;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, { type: string; description: string }>; required?: string[]; additionalProperties: false };
  run: (args: ToolArgs) => unknown;
}

export const TOOLS: ToolDefinition[] = [
  {
    name: "add_note",
    description: "Adds one note to the list on the page. Call it when the person asks to note, remember, or write down something.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "The note's text, in the person's words" } },
      required: ["text"],
      additionalProperties: false
    },
    run: ({ text }) => addNote(String(text ?? ""))
  },
  {
    name: "list_notes",
    description: "Returns every note on the page in the order they were added. Call it before answering a question about what has been noted.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: () => listNotes()
  }
];

/** Runs one tool and shapes its result the way an agent reads it; a thrown error becomes isError. */
export function executeTool(tool: ToolDefinition, args: ToolArgs): ToolResult {
  try {
    return { content: [{ type: "text", text: JSON.stringify(tool.run(args ?? {})) }] };
  } catch (cause) {
    return { content: [{ type: "text", text: JSON.stringify({ error: cause instanceof Error ? cause.message : String(cause) }) }], isError: true };
  }
}

/** The static tool list in the shape `webmcp-evals local -t schema.json` reads. */
export function toolsSchemaJson(): { name: string; description: string; inputSchema: object }[] {
  return TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}
