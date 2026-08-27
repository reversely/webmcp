/**
 * The PlanningAgent over a scripted model (#59): the model answers a stated item and relation with
 * two write_requirement calls, and the test checks the rows those calls write and the reply.
 */
import { Usage, type Model, type ModelRequest, type ModelResponse } from "@openai/agents";
import { beforeEach, describe, expect, it } from "vitest";
import { snapshot } from "../server/state";
import { issuesFor } from "../server/trace";
import { EMPTY_TURN_REPLY, runPlanningAgent } from "./planning-agent";
import { resetState, seedProject } from "./test-helpers";

type Script = (request: ModelRequest, turn: number) => ModelResponse["output"];

/** A Model that answers from a script and records every request it received. */
function scriptedModel(script: Script): Model & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  return {
    requests,
    async getResponse(request) {
      requests.push(request);
      return { usage: new Usage(), output: script(request, requests.length) };
    },
    // eslint-disable-next-line require-yield
    async *getStreamedResponse() {
      throw new Error("streaming is not scripted");
    }
  };
}

const call = (id: string, name: string, args: unknown) => ({ type: "function_call" as const, callId: id, name, status: "completed" as const, arguments: JSON.stringify(args) });
const say = (text: string) => ({ type: "message" as const, role: "assistant" as const, status: "completed" as const, content: [{ type: "output_text" as const, text }] });

describe("PlanningAgent records a stated item and relation (#59)", () => {
  beforeEach(resetState);

  it("calls write_requirement for the item with its kind and for the rule resolved to agreed names, then reports both", async () => {
    const projectId = seedProject();
    const model = scriptedModel((request, turn) => {
      if (turn === 1) {
        return [
          call("c1", "write_requirement", { type: "required_item", value: JSON.stringify({ name: "floor lamp", kind: "lighting" }) }),
          call("c2", "write_requirement", { type: "layout_requirement", value: JSON.stringify({ relation: "beside", subject: "floor lamp", objects: ["Deep Couch"] }) })
        ];
      }
      const results = (request.input as { type?: string; output?: unknown }[]).filter((i) => i.type === "function_call_result");
      expect(results).toHaveLength(2);
      return [say("Recorded: floor lamp (lighting), and floor lamp beside the deep couch.")];
    });
    const reply = await runPlanningAgent({ projectId, author: "Ben" }, [], "Add one more thing to what we agreed: a floor lamp beside the Deep couch.", { model });

    // The instructions tell the model to record a stated item or rule, and both tools are offered.
    const first = model.requests[0];
    expect(first.systemInstructions).toMatch(/write_requirement once per statement/);
    expect(first.systemInstructions).toMatch(/call source_item with that item's phrase/);
    expect(first.systemInstructions).toMatch(/call ingest_product_url straight away/);
    const tools = first.tools.map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(["write_requirement", "source_item", "source_room"]));
    const writeTool = first.tools.find((t) => t.name === "write_requirement") as { parameters: { properties: Record<string, unknown>; required: string[] } };
    expect(writeTool.parameters.required).toEqual(["type", "value"]);
    expect((writeTool.parameters.properties.type as { enum: string[] }).enum).toEqual(["required_item", "visual_direction", "layout_requirement"]);

    // The two calls land as two agreed rows shaped for the plan and the layout engine.
    const agreed = snapshot(projectId).requirements.filter((r) => r.status === "agreed");
    const item = agreed.find((r) => r.type === "required_item" && JSON.stringify(r.value_json).includes("floor lamp"));
    expect(item).toMatchObject({ source: "chat", created_by: "Ben", value_json: { name: "floor lamp", kind: "lighting" } });
    const rule = agreed.find((r) => r.type === "layout_requirement" && JSON.stringify(r.value_json).includes("beside"));
    expect(rule?.value_json).toEqual({ relation: "beside", subject: "floor lamp", objects: ["deep couch"] });
    // Nothing else was superseded, and the tool results carried the row ids back to the model.
    expect(agreed).toHaveLength(8);
    const results = (model.requests[1].input as { type?: string; output?: { text?: string } }[]).filter((i) => i.type === "function_call_result");
    const outputs = results.map((r) => JSON.parse(String((r.output as { text?: string })?.text ?? "{}")));
    expect(outputs[0]).toMatchObject({ created: true, type: "required_item", value: { name: "floor lamp", kind: "lighting" } });
    expect(outputs[1]).toMatchObject({ created: true, type: "layout_requirement" });
    expect(reply).toBe("Recorded: floor lamp (lighting), and floor lamp beside the deep couch.");
  });
});

describe("PlanningAgent retries an empty turn (#74)", () => {
  beforeEach(resetState);

  it("runs the turn again with a nudge when the model returns no text and no call, and uses the second answer", async () => {
    const projectId = seedProject();
    const model = scriptedModel((request, turn) => {
      if (turn === 1) return [say("")];
      const last = (request.input as { role?: string; content?: unknown }[]).at(-1);
      expect(String(last?.content)).toMatch(/last turn was empty/);
      return [say("Sourcing the floor lamp now.")];
    });
    const reply = await runPlanningAgent({ projectId, author: "Ben" }, [], "Source the floor lamp.", { model });
    expect(reply).toBe("Sourcing the floor lamp now.");
    expect(model.requests).toHaveLength(2);
  });

  it("answers with the stock reply and records an issue when the retry is empty too", async () => {
    const projectId = seedProject();
    const model = scriptedModel(() => [say("")]);
    const reply = await runPlanningAgent({ projectId, author: "Ben" }, [], "Source the floor lamp.", { model });
    expect(reply).toBe(EMPTY_TURN_REPLY);
    expect(model.requests).toHaveLength(2);
    expect(issuesFor(projectId).some((i) => /no text and no tool call/.test(i.message))).toBe(true);
  });
});
