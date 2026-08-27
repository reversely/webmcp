import { beforeEach, describe, expect, it } from "vitest";
import { classifyAddressReply, offerReply, requestInput, startRun } from "../domain/agent-run";
import { appState, snapshot } from "../server/state";
import type { RankingArtifact } from "./artifacts";
import { handleMessage } from "./messages";
import { approvalIndex, findCheaperReplacement } from "./replacement";
import { sourceRoom } from "./sourcing";
import { fakeCatalogProduct, fakeDeps, resetState, seedProject } from "./test-helpers";

describe("classifyAddressReply routing", () => {
  it("answers on a bare or embedded ZIP and declines otherwise", () => {
    expect(classifyAddressReply("10003")).toEqual({ answers: true, value: "10003" });
    expect(classifyAddressReply("Ship it to 55 Irving Pl, New York, NY 10003")).toEqual({ answers: true, value: "10003" });
    expect(classifyAddressReply("What is the budget?")).toEqual({ answers: false });
    expect(classifyAddressReply("call 212 555 1234")).toEqual({ answers: false });
  });

  it("resumes a waiting run on an answer and keeps it waiting on anything else", () => {
    resetState();
    const s = appState();
    const run = startRun(s.runs, { projectId: "p", goal: "g" });
    requestInput(s.runs, run.id, { field: "delivery_address", question: "Where?" });
    const miss = offerReply(s.runs, run.id, { memberId: "ben", text: "Is blue ok?" });
    expect(miss.answered).toBe(false);
    expect(s.runs.get(run.id)?.status).toBe("waiting_for_user");
    const hit = offerReply(s.runs, run.id, { memberId: "zach", text: "10003" });
    expect(hit).toMatchObject({ answered: true, field: "delivery_address", value: "10003" });
    expect(s.runs.get(run.id)?.status).toBe("running");
  });

  it("stores a full address line as given, not inferred", async () => {
    resetState();
    const projectId = seedProject({ address: false });
    const deps = fakeDeps();
    await sourceRoom(projectId, "Find a set", deps);
    await handleMessage(projectId, "zach", "55 Irving Pl, New York, NY 10003", { sourcing: deps });
    expect(snapshot(projectId).project.delivery_address_json).toMatchObject({ line1: "55 Irving Pl", city: "New York", region: "NY", postal_code: "10003", source: "given" });
  });
});

describe("approvalIndex", () => {
  it("reads approval phrases and ordinals", () => {
    expect(approvalIndex("approve")).toBe(0);
    expect(approvalIndex("Go with the second one")).toBe(1);
    expect(approvalIndex("use the second one")).toBe(1);
    expect(approvalIndex("use the 3rd one")).toBe(2);
    expect(approvalIndex("Find a cheaper coffee table")).toBeNull();
  });
});

describe("replacement flow", () => {
  beforeEach(resetState);

  it("ranks cheaper candidates that fit at the old placement and replaces on approval", async () => {
    const projectId = seedProject({ address: true });
    const deps = fakeDeps();
    await sourceRoom(projectId, "Find a set", deps);
    const s = appState();
    // Push the project over budget the way the pasted side table does (PRD 8.4).
    const { upsertCandidate } = await import("./catalog");
    const side = upsertCandidate(projectId, fakeCatalogProduct("side_table", 1, 29500), "side_table");
    s.store.candidates.set(side.candidate.id, { ...side.candidate, ranking_state: "selected" });
    const { regenerateBom } = await import("../domain/bom");
    regenerateBom(s.store, projectId);
    const before = snapshot(projectId);
    expect(before.budget.state).toBe("over");
    const oldItem = before.bom.find((b) => b.category === "coffee_table")!;
    const required = before.budget.committed_cents - 250000;

    const cheaper = [
      fakeCatalogProduct("coffee_table", 11, oldItem.product!.price_cents - required - 5000),
      fakeCatalogProduct("coffee_table", 12, oldItem.product!.price_cents - required + 1000),
      fakeCatalogProduct("coffee_table", 13, 9900, { metadata: { tech_specs: '150" W x 100" D x 18" H' } })
    ];
    const outcome = await findCheaperReplacement(projectId, "coffee_table", { ...deps, search: async () => cheaper });
    expect(outcome.status).toBe("ranked");
    if (outcome.status !== "ranked") return;
    expect(outcome.required_savings_cents).toBe(required);
    expect(outcome.ceiling_cents).toBe(oldItem.product!.price_cents - required);
    expect(outcome.ranked.map((r) => r.product_id)).toEqual([cheaper[0].id].map((id) => `coffee-table-shop-11.myshopify.com:${id}`));

    const artifact = snapshot(projectId).messages.find((m) => m.artifact?.kind === "ranking")!.artifact!.data as RankingArtifact;
    expect(artifact.rows.map((r) => r.status)).toEqual(["ranked", "eliminated", "eliminated"]);
    expect(artifact.rows[1].reason).toBe("insufficient savings");
    expect(artifact.rows[2].geometry).toBe("fail");
    expect(s.store.decisions.size).toBe(1);

    const messages = await handleMessage(projectId, "zach", "approve", { sourcing: deps });
    expect(messages.at(-1)?.text).toMatch(/^Replaced with coffee table 11/);
    const after = snapshot(projectId);
    expect(after.budget.state).not.toBe("over");
    expect(after.bom.find((b) => b.id === oldItem.id)?.status).toBe("removed");
    const newItem = after.bom.find((b) => b.category === "coffee_table" && b.status === "proposed")!;
    expect(after.placements.some((p) => p.bom_item_id === newItem.id)).toBe(true);
    expect([...s.store.decisions.values()].map((d) => d.type)).toEqual(["replacement_ranked", "product_replaced"]);
    expect(s.pendingReplacements.has(projectId)).toBe(false);
  });
});
