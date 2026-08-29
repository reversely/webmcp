// Checks every expectedCall in evals/webmcp/evals.json names a registered tool and that its
// literal arguments validate against that tool's inputSchema. Matcher objects ($contains, $any,
// $type) stand in for a value and are skipped. Run: npx tsx scripts/check-evals.ts
import { readFileSync } from "node:fs";
import { z } from "zod";
import { toolsSchemaJson } from "../src/webmcp/register";

type Call = { functionName?: string; arguments?: Record<string, unknown>; ordered?: Call[]; unordered?: Call[] };
type ToolSchema = { name: string; inputSchema: { required?: string[] } };

const tools = toolsSchemaJson() as ToolSchema[];
const validators = new Map(tools.map((t) => [t.name, z.fromJSONSchema(t.inputSchema as never)]));
const suite = JSON.parse(readFileSync("evals/webmcp/evals.json", "utf8")) as { name: string; expectedCall: Call[] }[];
let failures = 0;

function isMatcher(v: unknown): boolean {
  return typeof v === "object" && v !== null && Object.keys(v).some((k) => k.startsWith("$"));
}

function placeholder(prop: { type?: string; format?: string } | undefined): unknown {
  if (prop?.format === "uri") return "https://example.com/products/x";
  if (prop?.type === "integer" || prop?.type === "number") return 1;
  if (prop?.type === "object") return {};
  return "matcher";
}

function check(caseName: string, call: Call): void {
  for (const nested of [...(call.ordered ?? []), ...(call.unordered ?? [])]) check(caseName, nested);
  if (!call.functionName) return;
  const validator = validators.get(call.functionName);
  const tool = tools.find((t) => t.name === call.functionName);
  if (!validator || !tool) {
    failures++;
    console.error(`${caseName}: unknown tool ${call.functionName}`);
    return;
  }
  // A matcher satisfies a required property; substitute a placeholder that fits the property's
  // declared type and format so only literal arguments are validated.
  const props = (tool.inputSchema as { properties?: Record<string, { type?: string; format?: string }> }).properties ?? {};
  const probe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(call.arguments ?? {})) probe[k] = isMatcher(v) ? placeholder(props[k]) : v;
  for (const r of tool.inputSchema.required ?? []) {
    if (!(r in probe)) {
      failures++;
      console.error(`${caseName}: ${call.functionName} missing required argument ${r}`);
    }
  }
  const result = validator.safeParse(probe);
  if (!result.success) {
    failures++;
    console.error(`${caseName}: ${call.functionName} ${result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  }
}

for (const c of suite) for (const call of c.expectedCall) check(c.name, call);
console.log(`${suite.length} cases checked, ${failures} failures`);
process.exit(failures ? 1 : 0);
