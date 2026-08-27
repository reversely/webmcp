import { beforeEach, describe, expect, it } from "vitest";
import { currentProjectId, issuesFor, readTrace, recordIssue, recordSpan, resetTrace, spansFor, trim, TRIM_BYTES, withProject, withSpan, withSpanSync } from "./trace";

beforeEach(resetTrace);

describe("withSpan", () => {
  it("nests a child under the span it runs inside and records the return value as output", async () => {
    const result = await withSpan("p1", { kind: "agent_run", name: "PlanningAgent" }, async () => {
      const inner = await withSpan(null, { kind: "tool", name: "read_project", input: { a: 1 } }, async () => ({ ok: true }));
      withSpanSync(null, { kind: "step", name: "rank", prd_ref: "PRD 9 step 10" }, (span) => span.setOutput({ ranked: 3 }));
      return inner;
    });
    expect(result).toEqual({ ok: true });
    const spans = spansFor("p1");
    expect(spans.map((s) => s.name)).toEqual(["PlanningAgent", "read_project", "rank"]);
    const [run, tool, step] = spans;
    expect(tool.parent_id).toBe(run.id);
    expect(step.parent_id).toBe(run.id);
    expect(tool.project_id).toBe("p1");
    expect(tool.input).toEqual({ a: 1 });
    expect(tool.output).toEqual({ ok: true });
    expect(step.output).toEqual({ ranked: 3 });
    expect(step.prd_ref).toBe("PRD 9 step 10");
    expect(spans.every((s) => s.status === "ok" && typeof s.duration_ms === "number")).toBe(true);
  });

  it("marks a throwing span as error, keeps the message, and rethrows", async () => {
    await expect(withSpan("p1", { kind: "catalog", name: "search_catalog" }, async () => { throw new Error("HTTP 503"); })).rejects.toThrow("HTTP 503");
    const [span] = spansFor("p1");
    expect(span.status).toBe("error");
    expect(span.error).toBe("HTTP 503");
    expect(span.ended_at).toBeDefined();
  });

  it("withProject supplies the project to spans and issues that have none", async () => {
    await withProject("p2", async () => {
      expect(currentProjectId()).toBe("p2");
      await withSpan(null, { kind: "model", name: "visual_evaluation" }, async () => null);
      recordIssue(null, { source: "model visual_evaluation", message: "It failed." });
    });
    expect(spansFor("p2")).toHaveLength(1);
    expect(issuesFor("p2")[0]).toMatchObject({ project_id: "p2", severity: "warning", message: "It failed." });
  });
});

describe("trim", () => {
  it("caps the serialized size at TRIM_BYTES and cuts merchant prose harder than other strings", () => {
    const merchant = "m".repeat(5000);
    const plain = "x".repeat(5000);
    const out = trim({ untrusted_merchant_text: merchant, note: plain }) as { untrusted_merchant_text: string; note: string };
    expect(out.untrusted_merchant_text.length).toBeLessThan(200);
    expect(out.note.length).toBeLessThan(300);
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(TRIM_BYTES);

    const wide = trim(Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, "v".repeat(100)]))) as { _truncated: boolean; preview: string };
    expect(wide._truncated).toBe(true);
    expect(wide.preview.length).toBe(TRIM_BYTES);
  });

  it("shortens long arrays and never throws on odd values", () => {
    const out = trim({ list: Array.from({ length: 30 }, (_, i) => i), map: new Map([["a", 1]]), err: new Error("boom") }) as { list: unknown[]; map: string; err: unknown };
    expect(out.list).toHaveLength(21);
    expect(out.list[20]).toBe("… 10 more");
    expect(out.map).toBe("[Map of 1]");
    expect(out.err).toEqual({ error: "boom" });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => trim(cyclic)).not.toThrow();
  });
});

describe("readTrace", () => {
  it("returns only what changed after the cursor, including a span that ended after the first read", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const pending = withSpan("p3", { kind: "three_d", name: "request_model" }, () => gate);
    recordSpan("p3", { kind: "webmcp", name: "get_project_state", status: "ok", duration_ms: 12 });
    const first = readTrace("p3");
    expect(first.spans.map((s) => [s.name, s.status])).toEqual([["request_model", "running"], ["get_project_state", "ok"]]);
    expect(readTrace("p3", first.cursor).spans).toEqual([]);

    release();
    await pending;
    recordIssue("p3", { source: "three_d request_model", message: "Fell back to a proxy.", severity: "warning" });
    const second = readTrace("p3", first.cursor);
    expect(second.spans.map((s) => [s.name, s.status])).toEqual([["request_model", "ok"]]);
    expect(second.issues).toHaveLength(1);
    expect(second.cursor).toBeGreaterThan(first.cursor);
    expect(readTrace("other").spans).toEqual([]);
  });
});
