import { beforeEach, describe, expect, it } from "vitest";
import { budgetWindow } from "../domain/ranking";
import { appState, snapshot, geometryFor } from "../server/state";
import { issuesFor, spansFor } from "../server/trace";
import type { SourcingArtifact } from "./artifacts";
import { handleMessage } from "./messages";
import { ADDRESS_QUESTION, COUNTRY_ONLY_NOTE, NO_WINDOW_NOTE, selectionWindowFor, sideTablePriceFor, sourceRoom } from "./sourcing";
import { fakeDeps, resetState, seedProject } from "./test-helpers";

function sourcingArtifact(projectId: string): SourcingArtifact {
  const message = snapshot(projectId).messages.find((m) => m.artifact?.kind === "sourcing");
  return message!.artifact!.data as SourcingArtifact;
}

describe("budget window plumbing", () => {
  beforeEach(resetState);

  it("derives P_side from a side_table candidate, else from a priced required_item, else none", () => {
    const withCandidate = seedProject({ address: true, sideTable: 31000 });
    expect(sideTablePriceFor(withCandidate)).toBe(31000);
    expect(selectionWindowFor(withCandidate)).toEqual(budgetWindow(250000, 31000));

    const withRequirement = seedProject({ address: true });
    appState().requirements.set("req_side", {
      id: "req_side",
      project_id: withRequirement,
      scope: "project",
      type: "required_item",
      value_json: { category: "side_table", price_cents: 34500 },
      status: "agreed",
      source: "board",
      created_by: "zach"
    });
    expect(sideTablePriceFor(withRequirement)).toBe(34500);

    expect(sideTablePriceFor(seedProject({ address: true }))).toBeNull();
    expect(selectionWindowFor(seedProject({ address: true }))).toBeNull();
  });

  it("selects a subtotal inside [budget - P_side, budget) and reports the window on the artifact", async () => {
    const projectId = seedProject({ address: true, sideTable: 29500 });
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
    for (const category of ["sofa", "coffee_table", "ottoman", "rug"] as const) {
      expect(artifact.categories[category]).toMatchObject({ found: 3, available: 3, dimensioned: 3, compatible: 3, delivery_checked: 3, status: "selected" });
    }
    const bom = snapshot(projectId).bom.filter((b) => b.status !== "removed");
    expect(bom.map((b) => b.category).sort()).toEqual(["coffee_table", "ottoman", "rug", "sofa"]);
    expect(snapshot(projectId).budget.committed_cents).toBe(outcome.subtotal_cents);
    const geometry = geometryFor(projectId);
    expect(geometry?.collisions).toEqual([]);
    expect(geometry?.rugCoverage?.pass).toBe(true);
    expect(appState().runs.get(appState().activeRuns.get(projectId) ?? "")).toBeUndefined();

    // PRD 24: every PRD 9 step is a `step` span under the run's domain span, in order per category.
    const spans = spansFor(projectId);
    const root = spans.find((s) => s.kind === "domain" && s.name === "source_room");
    expect(root?.status).toBe("ok");
    const search = spans.find((s) => s.kind === "step" && s.prd_ref === "PRD 9 step 3");
    expect(search).toMatchObject({ name: "search sofa", status: "ok", input: { category: "sofa" }, output: { found: 3 } });
    expect(search?.parent_id).toBe(root?.id);
    const refs = new Set(spans.filter((s) => s.kind === "step").map((s) => s.prd_ref));
    for (const step of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) expect(refs.has(`PRD 9 step ${step}`), `step ${step}`).toBe(true);
    expect(refs.has("PRD 10")).toBe(true);
    // 3D generation is detached (PRD 15.1), so its spans may still run; everything else has ended.
    expect(spans.filter((s) => s.status === "running" && s.kind !== "three_d")).toEqual([]);
    expect(issuesFor(projectId).filter((i) => i.severity === "error")).toEqual([]);
  });

  it("selects the best combination under the budget, with no window, when the project names no side table", async () => {
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
    expect(sourcingArtifact(projectId).categories.sofa?.status).toBe("checking delivery");
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

import { withReplacementFloor } from "./sourcing";

describe("withReplacementFloor", () => {
  const row = (id: string, price_cents: number) => ({ id, category: "coffee_table", price_cents, rank: 1, why: [] }) as never;
  const window = budgetWindow(250000, 34500);
  it("keeps only coffee tables that cost at least the side table, so a replacement can absorb the overage", () => {
    const ranked = { coffee_table: [row("cheap", 8500), row("mid", 34500), row("dear", 60000)] };
    expect(withReplacementFloor(ranked, window).coffee_table!.map((r: { id: string }) => r.id)).toEqual(["mid", "dear"]);
  });
  it("falls back to the full list when nothing reaches the floor", () => {
    const ranked = { coffee_table: [row("cheap", 8500)] };
    expect(withReplacementFloor(ranked, window).coffee_table!.length).toBe(1);
  });
  it("applies no floor without a window", () => {
    const ranked = { coffee_table: [row("cheap", 8500), row("dear", 60000)] };
    expect(withReplacementFloor(ranked, null).coffee_table!.length).toBe(2);
  });
});
