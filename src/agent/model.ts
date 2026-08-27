/**
 * The one OpenAI client the agent modules share, plus a structured-output helper. The client is
 * created on first use so importing this module never needs the API key (tests mock the calls).
 */
import { z } from "zod";
import { recordIssue, withSpan } from "../server/trace";

export const MODEL = "gpt-5.6-terra";

type OpenAIClient = import("openai").default;

let client: OpenAIClient | null = null;

export async function openai(): Promise<OpenAIClient> {
  if (!client) {
    // The SDK is loaded lazily so route modules that only touch state stay cheap to import.
    const { default: OpenAI } = await import("openai");
    client = new OpenAI();
  }
  return client;
}

export function hasModelKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export type ContentPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "low" | "high" | "auto" };

/**
 * Asks the model for JSON that conforms to `schema` (strict JSON schema mode) and validates it.
 * Returns null when the key is missing, the request fails, or the output fails validation.
 */
export async function structuredCall<T extends z.ZodType>(
  schema: T,
  name: string,
  instructions: string,
  content: ContentPart[]
): Promise<z.infer<T> | null> {
  const parts = content.map((part) => (part.type === "input_text" ? { text: part.text } : { image: part.image_url }));
  return withSpan(null, { kind: "model", name, input: { model: MODEL, instructions: instructions.slice(0, 160), parts } }, async (span) => {
    if (!hasModelKey()) {
      span.setOutput({ skipped: "no OPENAI_API_KEY" });
      return null;
    }
    try {
      const api = await openai();
      const response = await api.responses.create({
        model: MODEL,
        instructions,
        input: [{ role: "user", content }],
        text: { format: { type: "json_schema", name, schema: z.toJSONSchema(schema) as Record<string, unknown>, strict: true } }
      });
      const usage = response.usage ? { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens } : null;
      const parsed = schema.safeParse(JSON.parse(response.output_text));
      span.setOutput({ usage, response_id: response.id, valid: parsed.success, result: parsed.success ? parsed.data : response.output_text });
      if (!parsed.success) {
        recordIssue(null, { source: `model ${name}`, message: `The ${name} model answer did not match its schema (${parsed.error.issues[0]?.message ?? "invalid"}); the caller uses its fallback for this call.` });
      }
      return parsed.success ? parsed.data : null;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      span.setOutput({ failed: message });
      recordIssue(null, { source: `model ${name}`, severity: "error", message: `The ${name} model call failed (${message}); the caller uses its fallback, so this result is missing until the call is retried.` });
      return null;
    }
  });
}
