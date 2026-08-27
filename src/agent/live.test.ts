/**
 * Live smoke test over the real model, Global Catalog, and merchant checkouts. Runs only with
 * LIVE_AGENT=1 and an OPENAI_API_KEY in the environment; the fast suite skips it.
 */
import { describe, expect, it } from "vitest";
import { appState, snapshot } from "../server/state";
import type { SourcingArtifact } from "./artifacts";
import { primeAddressReply } from "./address";
import { handleMessage } from "./messages";
import { resetState, seedProject } from "./test-helpers";

const live = process.env.LIVE_AGENT === "1" && Boolean(process.env.OPENAI_API_KEY);

describe.skipIf(!live)("live PlanningAgent", () => {
  it(
    "sources four categories under $2,500 after answering the address question",
    async () => {
      resetState();
      const projectId = seedProject({ address: false, requiredBy: "2026-09-15" });
      const started = Date.now();
      const first = await handleMessage(projectId, "zach", "Find a set that works for us and make sure everything can arrive by September 15");
      const question = first.find((m) => m.artifact?.kind === "question");
      expect(question?.text).toMatch(/delivery address/i);
      const s = appState();
      expect(s.runs.get(s.activeRuns.get(projectId)!)?.status).toBe("waiting_for_user");

      const second = await handleMessage(projectId, "zach", "10003");
      const elapsedMs = Date.now() - started;
      const snap = snapshot(projectId);
      const artifact = second.find((m) => m.artifact?.kind === "sourcing")!.artifact!.data as SourcingArtifact;
      console.log(`live run: ${(elapsedMs / 1000).toFixed(1)} s`, JSON.stringify({ categories: artifact.categories, subtotal: artifact.subtotal_cents, budget: snap.budget, last: second.at(-1)?.text }, null, 1));

      const categories = snap.bom.filter((b) => b.status !== "removed").map((b) => b.category).sort();
      expect(categories).toEqual(["coffee_table", "ottoman", "rug", "sofa"]);
      expect(snap.budget.committed_cents).toBeLessThan(250000);
      expect(snap.project.delivery_address_json?.postal_code).toBe("10003");
    },
    600_000
  );

  it(
    "stores a Canadian address line with its country and resumes without asking again",
    async () => {
      resetState();
      const projectId = seedProject({ address: false, requiredBy: "2026-09-15" });
      const first = await handleMessage(projectId, "zach", "Find a set that works for us");
      expect(first.filter((m) => m.artifact?.kind === "question")).toHaveLength(1);
      const s = appState();
      const runId = s.activeRuns.get(projectId)!;
      expect(s.runs.get(runId)?.status).toBe("waiting_for_user");

      const line = "5 york garden way north york on m6a 0g9";
      // The messages route primes the reading before handleMessage; the test does the same.
      await primeAddressReply(projectId, line);
      const second = await handleMessage(projectId, "zach", line);
      const snap = snapshot(projectId);
      console.log("live address:", JSON.stringify(snap.project.delivery_address_json), "run:", s.runs.get(runId)?.status, "last:", second.at(-1)?.text);
      expect(snap.project.delivery_address_json).toMatchObject({ country: "CA", region: "ON", postal_code: "M6A 0G9", currency: "CAD", source: "given" });
      expect(snap.project.delivery_address_json?.city?.toLowerCase()).toContain("north york");
      expect(s.runs.get(runId)?.status).not.toBe("waiting_for_user");
      expect(snap.messages.filter((m) => m.artifact?.kind === "question")).toHaveLength(1);
    },
    600_000
  );
});
