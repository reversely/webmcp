import { beforeEach, describe, expect, it } from "vitest";
import { budgetWindow } from "../domain/ranking";
import { appState, snapshot, geometryFor } from "../server/state";
import { issuesFor, spansFor } from "../server/trace";
import type { SourcingArtifact } from "./artifacts";
import { handleMessage } from "./messages";
import { ADDRESS_QUESTION, COUNTRY_ONLY_NOTE, NO_WINDOW_NOTE, extraItemPriceFor, selectionWindowFor, sourceRoom, withReplacementFloor } from "./sourcing";
import { EXTRA, fakeDeps, ITEM_NAMES, resetState, seedProject } from "./test-helpers";

function sourcingArtifact(projectId: string): SourcingArtifact {
  const message = snapshot(projectId).messages.find((m) => m.artifact?.kind === "sourcing");
  return message!.artifact!.data as SourcingArtifact;
}

describe("budget window plumbing", () => {
  beforeEach(resetState);

  it("derives P_side from a candidate outside the required items, else from a priced required_item, else none", () => {
    const withCandidate = seedProject({ address: true, extraPrice: 31000 });
    expect(extraItemPriceFor(withCandidate)).toBe(31000);
    expect(selectionWindowFor(withCandidate)).toEqual(budgetWindow(250000, 31000));

    const withRequirement = seedProject({ address: true });
    appState().requirements.set("req_extra", {
      id: "req_extra",
      project_id: withRequirement,
      scope: "project",
      type: "required_item",
      value_json: { name: EXTRA.name, kind: null, price_cents: 34500 },
      status: "agreed",
      source: "board",
      created_by: "zach"
    });
    expect(extraItemPriceFor(withRequirement)).toBe(34500);

    expect(extraItemPriceFor(seedProject({ address: true }))).toBeNull();
    expect(selectionWindowFor(seedProject({ address: true }))).toBeNull();
  });

  it("selects a subtotal inside [budget - P_side, budget) and reports the window on the artifact", async () => {
    const projectId = seedProject({ address: true, extraPrice: 29500 });
    const deps = fakeDeps();
    const outcome = await sourceRoom(projectId, "Find a set", deps);
    expect(outcome.status).toBe("complete");
    if (outcome.status !== "complete") return;
    expect(outcome.subtotal_cents).toBeGreaterThanOrEqual(220500);
    expect(outcome.subtotal_cents).toBeLessThan(250000);
    const artifact = sourcingArtifact(projectId);
    expect(artifact.window).toEqual({ min_cents: 220500, max_cents: 250000 });
    expect(artifact.notes).toBeUndefined();
    expect(artifact.subtotal_cents).toBe(outcome.subtotal_cents);
    for (const name of ITEM_NAMES) {
      expect(artifact.categories[name]).toMatchObject({ found: 3, available: 3, dimensioned: 3, compatible: 3, delivery_checked: 3, status: "selected" });
    }
    const bom = snapshot(projectId).bom.filter((b) => b.status !== "removed");
    expect(bom.map((b) => b.category).sort()).toEqual([...ITEM_NAMES].sort());
    expect(bom.find((b) => b.category === "big rug")?.kind).toBe("soft_floor");
    // The inferred kind is written back onto the requirement row so the UI can show and edit it.
    const rug = snapshot(projectId).requirements.find((r) => r.type === "required_item" && JSON.stringify(r.value_json).includes("big rug"));
    expect(rug?.value_json).toEqual({ name: "big rug", kind: "soft_floor" });
    expect(snapshot(projectId).budget.committed_cents).toBe(outcome.subtotal_cents);
    const geometry = geometryFor(projectId);
    expect(geometry?.collisions).toEqual([]);
    expect(geometry?.rules).toHaveLength(1);
    expect(geometry?.rules[0]).toMatchObject({ pass: true, rule: { relation: "under", subject: "big rug" } });
    expect(appState().runs.get(appState().activeRuns.get(projectId) ?? "")).toBeUndefined();

    // PRD 24: every PRD 9 step is a `step` span under the run's domain span, in order per category.
    const spans = spansFor(projectId);
    const root = spans.find((s) => s.kind === "domain" && s.name === "source_room");
    expect(root?.status).toBe("ok");
    const search = spans.find((s) => s.kind === "step" && s.prd_ref === "PRD 9 step 3");
    expect(search).toMatchObject({ name: "search deep couch", status: "ok", input: { category: "deep couch", kind: "seating", query: "three seat sofa" }, output: { found: 3 } });
    expect(search?.parent_id).toBe(root?.id);
    const refs = new Set(spans.filter((s) => s.kind === "step").map((s) => s.prd_ref));
    for (const step of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) expect(refs.has(`PRD 9 step ${step}`), `step ${step}`).toBe(true);
    expect(refs.has("PRD 10")).toBe(true);
    // 3D generation is detached (PRD 15.1), so its spans may still run; everything else has ended.
    expect(spans.filter((s) => s.status === "running" && s.kind !== "three_d")).toEqual([]);
    expect(issuesFor(projectId).filter((i) => i.severity === "error")).toEqual([]);
  });

  it("selects the best combination under the budget, with no window, when the project knows no extra item", async () => {
    const projectId = seedProject({ address: true });
    const outcome = await sourceRoom(projectId, "Find a set", fakeDeps());
    expect(outcome.status).toBe("complete");
    if (outcome.status !== "complete") return;
    expect(outcome.subtotal_cents).toBeLessThan(250000);
    expect(outcome.subtotal_cents).toBeGreaterThan(0);
    const artifact = sourcingArtifact(projectId);
    expect(artifact.window).toBeUndefined();
    expect(artifact.notes).toEqual([NO_WINDOW_NOTE]);
    expect(snapshot(projectId).bom.filter((b) => b.status !== "removed")).toHaveLength(4);
  });
});

describe("address gate", () => {
  beforeEach(resetState);

  it("pauses before the first delivery check, asks for the address, and resumes on a ZIP reply", async () => {
    const projectId = seedProject({ address: false });
    const deps = fakeDeps();
    const outcome = await sourceRoom(projectId, "Find a set that arrives by September 15", deps);
    expect(outcome.status).toBe("waiting_for_user");
    expect(deps.deliveryCalls).toHaveLength(0);

    const s = appState();
    const runId = s.activeRuns.get(projectId)!;
    expect(s.runs.get(runId)?.status).toBe("waiting_for_user");
    expect(s.runs.get(runId)?.missing_fields_json).toEqual(["delivery_address"]);
    const question = snapshot(projectId).messages.find((m) => m.artifact?.kind === "question");
    expect(question?.text).toBe(ADDRESS_QUESTION);
    expect(question?.artifact?.data).toMatchObject({ run_id: runId, field: "delivery_address" });
    expect(sourcingArtifact(projectId).categories["deep couch"]?.status).toBe("checking delivery");
    expect(sourcingArtifact(projectId).notes).toContain(COUNTRY_ONLY_NOTE);

    const messages = await handleMessage(projectId, "zach", "10003", { sourcing: deps });
    expect(snapshot(projectId).project.delivery_address_json).toMatchObject({ city: "New York", region: "NY", postal_code: "10003", country: "US", source: "inferred" });
    expect(deps.deliveryCalls.length).toBeGreaterThan(0);
    expect(s.runs.get(runId)?.status).toBe("complete");
    expect(s.activeRuns.has(projectId)).toBe(false);
    expect(messages.at(-1)?.text).toMatch(/^Selected /);
    expect(snapshot(projectId).bom).toHaveLength(4);
  });

  it("treats a non-answer as a new request while the run keeps waiting", async () => {
    const projectId = seedProject({ address: false });
    const deps = fakeDeps();
    await sourceRoom(projectId, "Find a set", deps);
    const calls: string[] = [];
    await handleMessage(projectId, "ben", "What is the budget?", { sourcing: deps, runAgent: async (_ctx, _history, text) => (calls.push(text), "The budget is $2,500.") });
    expect(calls).toEqual(["What is the budget?"]);
    const s = appState();
    expect(s.runs.get(s.activeRuns.get(projectId)!)?.status).toBe("waiting_for_user");
    expect(deps.deliveryCalls).toHaveLength(0);
  });
});

describe("withReplacementFloor", () => {
  const row = (id: string, price_cents: number) => ({ id, category: "round coffee table", price_cents, rank: 1, why: [] }) as never;
  const window = budgetWindow(250000, 34500);
  const required = ["deep couch", "round coffee table"];
  const couch = [row("couch", 120000)];
  it("keeps only pivot-item candidates that cost at least the extra item, so a replacement can absorb the overage", () => {
    const ranked = { "deep couch": couch, "round coffee table": [row("cheap", 8500), row("mid", 34500), row("dear", 60000)] };
    const floored = withReplacementFloor(ranked, window, required);
    expect(floored["round coffee table"].map((r: { id: string }) => r.id)).toEqual(["mid", "dear"]);
    expect(floored["deep couch"]).toBe(couch);
  });
  it("falls back to the full list when nothing reaches the floor", () => {
    const ranked = { "deep couch": couch, "round coffee table": [row("cheap", 8500), row("cheaper", 8000)] };
    expect(withReplacementFloor(ranked, window, required)["round coffee table"].length).toBe(2);
  });
  it("applies no floor without a window", () => {
    const ranked = { "deep couch": couch, "round coffee table": [row("cheap", 8500), row("dear", 60000)] };
    expect(withReplacementFloor(ranked, null, required)["round coffee table"].length).toBe(2);
  });
});
