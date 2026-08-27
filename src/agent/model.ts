/**
 * The one OpenAI client the agent modules share, plus a structured-output helper. The client is
 * created on first use so importing this module never needs the API key (tests mock the calls).
 */
import { z } from "zod";

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
  if (!hasModelKey()) return null;
  try {
    const api = await openai();
    const response = await api.responses.create({
      model: MODEL,
      instructions,
      input: [{ role: "user", content }],
      text: { format: { type: "json_schema", name, schema: z.toJSONSchema(schema) as Record<string, unknown>, strict: true } }
    });
    const parsed = schema.safeParse(JSON.parse(response.output_text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
