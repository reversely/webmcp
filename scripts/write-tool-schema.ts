// Writes evals/webmcp/schema.json from the tool definitions so the evals suite
// never drifts from what the page registers. Run: npx tsx scripts/write-tool-schema.ts
import { writeFileSync } from "node:fs";
import { toolsSchemaJson } from "../src/webmcp/register";

writeFileSync("evals/webmcp/schema.json", JSON.stringify(toolsSchemaJson(), null, 2) + "\n");
console.log("wrote evals/webmcp/schema.json");
