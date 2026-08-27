import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { budgetWindow } from "../domain/ranking";
import { appState, snapshot, geometryFor } from "../server/state";
import type { SourcingArtifact } from "./artifacts";
import { handleMessage } from "./messages";
import { ADDRESS_QUESTION, DEFAULT_SIDE_TABLE_PRICE_CENTS, sideTablePriceCents, sourceRoom } from "./sourcing";
import { fakeDeps, resetState, seedProject } from "./test-helpers";

function sourcingArtifact(projectId: string): SourcingArtifact {
  const message = snapshot(projectId).messages.find((m) => m.artifact?.kind === "sourcing");
  return message!.artifact!.data as SourcingArtifact;
}

describe("budget window plumbing", () => {
  const original = process.env.SIDE_TABLE_PRICE_CENTS;
  afterEach(() => {
    if (original === undefined) delete process.env.SIDE_TABLE_PRICE_CENTS;
    else process.env.SIDE_TABLE_PRICE_CENTS = original;
  });

  it("reads P_side from the environment and defaults to 29500", () => {
    delete process.env.SIDE_TABLE_PRICE_CENTS;
    expect(sideTablePriceCents()).toBe(DEFAULT_SIDE_TABLE_PRICE_CENTS);
    process.env.SIDE_TABLE_PRICE_CENTS = "31000";
    expect(sideTablePriceCents()).toBe(31000);
    expect(budgetWindow(250000, sideTablePriceCents())).toEqual({ min_cents: 219000, max_cents: 250000 });
  });

  it("selects a subtotal inside [budget - P_side, budget) and reports the window on the artifact", async () => {
    resetState();
    const projectId = seedProject({ address: true });
    const deps = fakeDeps({ sideTablePriceCents: 29500 });
    const outcome = await sourceRoom(projectId, "Find a set", deps);
    expect(outcome.status).toBe("complete");
    if (outcome.status !== "complete") return;
    expect(outcome.subtotal_cents).toBeGreaterThanOrEqual(220500);
    expect(outcome.subtotal_cents).toBeLessThan(250000);
    const artifact = sourcingArtifact(projectId);
    expect(artifact.window).toEqual({ min_cents: 220500, max_cents: 250000 });
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
