import { beforeEach, describe, expect, it } from "vitest";
import { appState, createProject, pushMessage, upsertArtifact } from "./state";
import { resetTrace, withSpan } from "./trace";
import { streamRun, type RunEvent } from "./run-events";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("streamRun", () => {
  beforeEach(() => {
    globalThis.__plannerState = undefined;
    resetTrace();
  });

  it("emits the tool span before the artifact it writes, then the reply, then done", async () => {
    const { id } = createProject({ name: "p", budget_cents: 1000, required_by: null });
    pushMessage(id, { role: "user", author: "Zach", text: "earlier" });
    const events: RunEvent[] = [];
    await streamRun(
      id,
      async () => {
        pushMessage(id, { role: "user", author: "Zach", text: "find a set" });
        await withSpan(id, { kind: "tool", name: "source_room" }, async () => {
          await wait(30);
          upsertArtifact(id, { kind: "sourcing", id: "art_1", data: { rows: 0 } }, "Finding your room");
          await wait(30);
          upsertArtifact(id, { kind: "sourcing", id: "art_1", data: { rows: 1 } }, "Finding your room");
        });
        pushMessage(id, { role: "agent", author: "PlanningAgent", text: "Done." });
        return appState().messages.get(id)!;
      },
      (e) => events.push(e)
    );
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("text");
    expect((events[0] as { message: { text: string } }).message.text).toBe("find a set");
    expect(types.indexOf("tool")).toBeLessThan(types.indexOf("artifact"));
    expect(events.filter((e) => e.type === "artifact")).toHaveLength(2);
    const tools = events.filter((e): e is Extract<RunEvent, { type: "tool" }> => e.type === "tool");
    expect(tools.map((t) => t.tool.status)).toEqual(["running", "ok"]);
    expect(types.at(-2)).toBe("text");
    expect(types.at(-1)).toBe("done");
  });

  it("classifies a question artifact and ends with error when the run throws", async () => {
    const { id } = createProject({ name: "p", budget_cents: 1000, required_by: null });
    const events: RunEvent[] = [];
    await streamRun(
      id,
      async () => {
        upsertArtifact(id, { kind: "question", id: "q_1", data: { question: "Where to?" } }, "Where to?");
        throw new Error("boom");
      },
      (e) => events.push(e)
    );
    expect(events.map((e) => e.type)).toEqual(["question", "error"]);
    expect((events[1] as { error: string }).error).toBe("boom");
  });
});
