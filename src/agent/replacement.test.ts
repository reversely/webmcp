/**
 * Replacement when the named item cannot cover the overage (#64): the flow explains it in the
 * named item's artifact and ranks the other required lines that can, one artifact each; approval
 * commits every line. The catalog and the model are both mocked.
 */
import { Usage, type Model, type ModelRequest, type ModelResponse } from "@openai/agents";
import { beforeEach, describe, expect, it } from "vitest";
import { regenerateBom } from "../domain/bom";
import { appState, snapshot } from "../server/state";
import type { RankingArtifact } from "./artifacts";
import { upsertCandidate } from "./catalog";
import { handleMessage } from "./messages";
import { runPlanningAgent } from "./planning-agent";
import { approveReplacement, findCheaperReplacement } from "./replacement";
import { writeLayout } from "./sourcing";
import { EXTRA, fakeCatalogProduct, fakeDeps, resetState, seedProject } from "./test-helpers";

/** The BOM every case starts from: the picked price per item and the cheaper prices sourcing also saw. */
const PICKS: Record<string, { pick: number; seen: number[] }> = {
  "deep couch": { pick: 149900, seen: [89900] },
  "round coffee table": { pick: 15999, seen: [9900] },
  "leather ottoman": { pick: 24900, seen: [14900] },
  "big rug": { pick: 39900, seen: [19900] }
};
const SUBTOTAL = Object.values(PICKS).reduce((sum, p) => sum + p.pick, 0);

/** A placed BOM at the picked prices, then an extra item priced so the project is over by `overage`. */
function seedOverBudget(overage: number): string {
  const projectId = seedProject({ address: true });
  const s = appState();
  for (const [name, { pick, seen }] of Object.entries(PICKS)) {
    const kind = s.kinds.get(name)!.kind;
    const picked = upsertCandidate(projectId, fakeCatalogProduct(name, 1, pick), name, kind);
    s.store.candidates.set(picked.candidate.id, { ...picked.candidate, ranking_state: "selected" });
    seen.forEach((price, i) => {
      const row = upsertCandidate(projectId, fakeCatalogProduct(name, i + 2, price), name, kind);
      s.store.candidates.set(row.candidate.id, { ...row.candidate, ranking_state: "ranked" });
    });
  }
  regenerateBom(s.store, projectId);
  expect(writeLayout(projectId)).toBe(true);
  const extra = upsertCandidate(projectId, fakeCatalogProduct(EXTRA.name, 1, 250000 - SUBTOTAL + overage), EXTRA.name, EXTRA.kind);
  s.store.candidates.set(extra.candidate.id, { ...extra.candidate, ranking_state: "selected" });
  regenerateBom(s.store, projectId);
  expect(snapshot(projectId).budget.overage_cents).toBe(overage);
  return projectId;
}

/** A catalog that answers each item's search with the given prices, honouring the ceiling like the real one. */
function catalog(prices: Record<string, number[]>) {
  return fakeDeps({
    search: async (item, options) => (prices[item.name] ?? []).filter((p) => options?.maxCents === undefined || p <= options.maxCents).map((p, i) => fakeCatalogProduct(item.name, 20 + i, p))
  });
}

function rankingArtifacts(projectId: string): RankingArtifact[] {
  return snapshot(projectId).messages.flatMap((m) => (m.artifact?.kind === "ranking" ? [m.artifact.data as RankingArtifact] : []));
}

function bomLine(projectId: string, name: string) {
  return snapshot(projectId).bom.find((b) => b.category === name && b.status !== "removed")!;
}

describe("find_cheaper_replacement when the named item cannot cover the overage (#64)", () => {
  beforeEach(resetState);

  it("keeps the one-item path when the named item can absorb the overage", async () => {
    const projectId = seedOverBudget(5000);
    const outcome = await findCheaperReplacement(projectId, "Round Coffee Table", catalog({ "round coffee table": [9000, 12000] }));
    expect(outcome.status).toBe("ranked");
    if (outcome.status !== "ranked") return;
    expect(outcome.ceiling_cents).toBe(10999);
    expect(outcome.lines.map((l) => [l.category, l.required_savings_cents])).toEqual([["round coffee table", 5000]]);
    expect(outcome.ranked.map((r) => r.price_cents)).toEqual([9000]);
    const artifacts = rankingArtifacts(projectId);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].notes).toBeUndefined();
    expect(artifacts[0].rows.map((r) => r.status)).toEqual(["selected"]);

    const messages = await handleMessage(projectId, "zach", "approve");
    expect(messages.at(-1)?.text).toMatch(/^Replaced with round coffee table 20\./);
    expect(snapshot(projectId).budget.state).not.toBe("over");
  });

  it("ranks the single other line with the largest price when the named item's ceiling is zero", async () => {
    const projectId = seedOverBudget(20000);
    const oldCouch = bomLine(projectId, "deep couch");
    const oldTable = bomLine(projectId, "round coffee table");
    const searched: string[] = [];
    const deps = catalog({ "deep couch": [120000], "round coffee table": [9000] });
    const outcome = await findCheaperReplacement(projectId, "round coffee table", { ...deps, search: async (item, options) => (searched.push(item.name), deps.search(item, options)) });
    expect(outcome.status).toBe("ranked");
    if (outcome.status !== "ranked") return;
    // A zero ceiling means no search for the named item; the couch can absorb the whole overage.
    expect(searched).toEqual(["deep couch"]);
    expect(outcome.ceiling_cents).toBe(0);
    expect(outcome.ranked).toEqual([]);
    expect(outcome.lines.map((l) => [l.category, l.required_savings_cents, l.ceiling_cents])).toEqual([["deep couch", 20000, 129900]]);
    expect(outcome.explanation).toContain("$159.99");
    expect(outcome.explanation).toContain("$200");
    expect(outcome.explanation).toMatch(/Replacing the deep couch \(\$1,499\) instead can recover \$200/);

    const [named, couch] = rankingArtifacts(projectId);
    expect(named.category).toBe("round coffee table");
    expect(named.rows).toEqual([]);
    expect(named.notes).toEqual([
      "A cheaper round coffee table cannot recover the budget on its own: it costs $159.99 and the budget needs $200 back, so a replacement would have to cost $0 or less, and the cheapest round coffee table the project has seen costs $99.",
      "Replacing the deep couch ($1,499) instead can recover $200."
    ]);
    expect(couch.category).toBe("deep couch");
    expect(couch.required_savings_cents).toBe(20000);
    expect(couch.rows.map((r) => [r.price_cents, r.savings_cents, r.status])).toEqual([[120000, 29900, "selected"]]);

    const messages = await handleMessage(projectId, "zach", "approve");
    expect(messages.at(-1)?.text).toBe("Replaced with deep couch 20. Committed $2,401 (under).");
    const after = snapshot(projectId);
    expect(after.bom.find((b) => b.id === oldCouch.id)?.status).toBe("removed");
    expect(after.bom.find((b) => b.id === oldTable.id)?.status).toBe("proposed");
    const newCouch = bomLine(projectId, "deep couch");
    expect(newCouch.product!.price_cents).toBe(120000);
    expect(after.placements.some((p) => p.bom_item_id === newCouch.id)).toBe(true);
    expect(after.placements.some((p) => p.bom_item_id === oldCouch.id)).toBe(false);
  });

  it("falls through to another line when the named item's search finds nothing under its ceiling", async () => {
    const projectId = seedOverBudget(15000);
    const outcome = await findCheaperReplacement(projectId, "round coffee table", catalog({ "round coffee table": [5000], "deep couch": [130000] }));
    expect(outcome.status).toBe("ranked");
    if (outcome.status !== "ranked") return;
    expect(outcome.ceiling_cents).toBe(999);
    expect(outcome.lines.map((l) => l.category)).toEqual(["deep couch"]);
    const [named] = rankingArtifacts(projectId);
    expect(named.rows).toEqual([]);
    expect(named.notes?.[0]).toBe("No round coffee table priced at or under $9.99 fits: it costs $159.99 and the budget needs $150 back, so a cheaper round coffee table cannot recover the budget on its own.");
  });

  it("splits the overage across two lines when no single line can absorb it, and approval commits both in order", async () => {
    const projectId = seedOverBudget(70000);
    const outcome = await findCheaperReplacement(projectId, "round coffee table", catalog({ "deep couch": [95000], "big rug": [20000], "leather ottoman": [10000] }));
    expect(outcome.status).toBe("ranked");
    if (outcome.status !== "ranked") return;
    expect(outcome.lines.map((l) => [l.category, l.required_savings_cents, l.ceiling_cents])).toEqual([
      ["deep couch", 52500, 97400],
      ["big rug", 17500, 22400]
    ]);
    expect(outcome.explanation).toContain("Replacing the deep couch ($1,499) and the big rug ($399) together can recover $700: $525 from the deep couch and $175 from the big rug.");
    const artifacts = rankingArtifacts(projectId);
    expect(artifacts.map((a) => [a.category, a.selected_product_id !== undefined])).toEqual([
      ["round coffee table", false],
      ["deep couch", true],
      ["big rug", true]
    ]);

    const messages = await handleMessage(projectId, "zach", "approve");
    expect(messages.at(-1)?.text).toBe("Replaced the deep couch with deep couch 20 and the big rug with big rug 20. Committed $2,452 (under).");
    const s = appState();
    const decisions = [...s.store.decisions.values()].filter((d) => d.type === "product_replaced");
    expect(decisions.map((d) => (d.payload_json as { old_item_id?: string; category?: string }).category ?? bomCategory(projectId, d))).toEqual(["deep couch", "big rug"]);
    expect(snapshot(projectId).budget.committed_cents).toBeLessThanOrEqual(250000);
    expect(bomLine(projectId, "deep couch").product!.price_cents).toBe(95000);
    expect(bomLine(projectId, "big rug").product!.price_cents).toBe(20000);
    expect(s.pendingReplacements.has(projectId)).toBe(false);
  });

  it("explains that nothing can reach the budget and ranks no rows when no pair of lines can", async () => {
    const projectId = seedOverBudget(90000);
    const outcome = await findCheaperReplacement(projectId, "round coffee table", catalog({ "deep couch": [50000] }));
    expect(outcome.status).toBe("no_candidates");
    if (outcome.status !== "no_candidates") return;
    expect(outcome.explanation).toContain("No other required line, alone or paired with another, can drop by $900, so no replacement reaches the budget.");
    const artifacts = rankingArtifacts(projectId);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].rows).toEqual([]);
    expect(artifacts[0].notes).toHaveLength(2);
    expect(appState().pendingReplacements.has(projectId)).toBe(false);
    expect(approveReplacement(projectId, 0, "zach")).toEqual({ status: "nothing_pending" });
  });
});

/** Reads the replaced line's category off the decision's item id when the payload carries only ids. */
function bomCategory(projectId: string, decision: { payload_json: unknown }): string | undefined {
  const payload = decision.payload_json as { old_item_id?: string; old_bom_item_id?: string };
  const id = payload.old_item_id ?? payload.old_bom_item_id;
  return snapshot(projectId).bom.find((b) => b.id === id)?.category;
}

type Script = (request: ModelRequest, turn: number) => ModelResponse["output"];

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

describe("PlanningAgent relays which items the replacement proposes (#64)", () => {
  beforeEach(resetState);

  it("hands the model the lines and explanation, and the instructions tell it to name the items and why", async () => {
    const projectId = seedOverBudget(20000);
    let toolResult: { lines: { category: string }[]; explanation: string } | undefined;
    const model = scriptedModel((request, turn) => {
      if (turn === 1) return [call("c1", "find_cheaper_replacement", { item: "round coffee table" })];
      const result = (request.input as { type?: string; output?: unknown }[]).find((i) => i.type === "function_call_result")!;
      const output = result.output as { text?: string } | string;
      toolResult = JSON.parse(typeof output === "string" ? output : output.text!) as typeof toolResult;
      return [say(`${toolResult!.explanation} Approve to go ahead.`)];
    });
    const reply = await runPlanningAgent({ projectId, author: "Zach" }, [], "Find a cheaper round coffee table that still matches everything we agreed on.", { model, sourcing: catalog({ "deep couch": [120000] }) });
    expect(model.requests[0].systemInstructions).toMatch(/say which items you propose replacing and why/);
    expect(toolResult?.lines.map((l) => l.category)).toEqual(["deep couch"]);
    expect(reply).toContain("deep couch");
    expect(reply).toContain("$200");
    expect(appState().pendingReplacements.get(projectId)?.category).toBe("deep couch");
  });
});
