import { describe, expect, it } from "vitest";
import {
  checkpoint,
  classifyAddressReply,
  complete,
  createInMemoryStore,
  failRecoverable,
  offerReply,
  reattach,
  requestInput,
  retry,
  startRun
} from "./index";

const FIXED_NOW = new Date("2026-08-27T10:00:00.000Z");
const CART_STEP = { tool: "evaluate_delivery", candidateId: "cand-1" };
const ADDRESS_QUESTION = "What delivery address should I use to check arrival dates?";

function runWaitingForAddress() {
  const store = createInMemoryStore({ clock: () => FIXED_NOW });
  const run = startRun(store, { projectId: "proj-1", goal: "room by September 15" });
  checkpoint(store, run.id, CART_STEP);
  requestInput(store, run.id, { field: "delivery_address", question: ADDRESS_QUESTION });
  return { store, runId: run.id };
}

describe("PRD 5.2 sequence", () => {
  it("starts running with the injected clock", () => {
    const store = createInMemoryStore({ clock: () => FIXED_NOW });
    const run = startRun(store, { projectId: "proj-1", goal: "room by September 15" });
    expect(run.status).toBe("running");
    expect(run.started_at).toBe(FIXED_NOW.toISOString());
    expect(run.completed_at).toBeNull();
  });

  it("waits for the address, resumes on 10003, and keeps the checkpoint", () => {
    const { store, runId } = runWaitingForAddress();
    expect(store.get(runId)?.status).toBe("waiting_for_user");
    expect(store.get(runId)?.missing_fields_json).toEqual(["delivery_address"]);
    expect(store.events).toEqual([
      {
        type: "AGENT_WAITING_FOR_USER",
        runId,
        projectId: "proj-1",
        field: "delivery_address",
        question: ADDRESS_QUESTION
      }
    ]);

    const outcome = offerReply(store, runId, { memberId: "zach", text: " 10003 " });
    expect(outcome).toMatchObject({ answered: true, field: "delivery_address", value: "10003" });
    const resumed = store.get(runId);
    expect(resumed?.status).toBe("running");
    expect(resumed?.missing_fields_json).toEqual([]);
    expect(resumed?.pending_operation_json).toEqual(CART_STEP);
  });

  it("takes any next message as the address answer, so the question is asked once", () => {
    const { store, runId } = runWaitingForAddress();
    const outcome = offerReply(store, runId, { memberId: "zach", text: "also make the rug bigger" });
    expect(outcome).toMatchObject({ answered: true, field: "delivery_address", value: "also make the rug bigger" });
    expect(store.get(runId)?.status).toBe("running");
    expect(store.get(runId)?.missing_fields_json).toEqual([]);
    expect(store.get(runId)?.pending_operation_json).toEqual(CART_STEP);
  });

  it("accepts the answer from a second project member", () => {
    const { store, runId } = runWaitingForAddress();
    const outcome = offerReply(store, runId, { memberId: "sam", text: "ship it to 10003 please" });
    expect(outcome).toMatchObject({ answered: true, memberId: "sam", value: "ship it to 10003 please" });
    expect(store.get(runId)?.status).toBe("running");
  });

  it("keeps waiting on a field no classifier knows", () => {
    const store = createInMemoryStore({ clock: () => FIXED_NOW });
    const run = startRun(store, { projectId: "proj-1", goal: "g" });
    requestInput(store, run.id, { field: "budget", question: "How much?" });
    expect(offerReply(store, run.id, { memberId: "zach", text: "2500" })).toMatchObject({ answered: false, treatedAsNewRequest: true });
    expect(store.get(run.id)?.status).toBe("waiting_for_user");
  });

  it("passes the field to an injected classifier", () => {
    const { store, runId } = runWaitingForAddress();
    const seen: string[] = [];
    offerReply(store, runId, { memberId: "zach", text: "x" }, (text, field) => {
      seen.push(`${field}:${text}`);
      return { answers: true, value: { custom: true } };
    });
    expect(seen).toEqual(["delivery_address:x"]);
    expect(store.get(runId)?.status).toBe("running");
  });

  it("completes with a timestamp from the clock", () => {
    const store = createInMemoryStore({ clock: () => FIXED_NOW });
    const run = startRun(store, { projectId: "proj-1", goal: "g" });
    expect(complete(store, run.id)).toMatchObject({
      status: "complete",
      completed_at: FIXED_NOW.toISOString()
    });
  });
});

describe("illegal transitions", () => {
  it("rejects complete while waiting for the user", () => {
    const { store, runId } = runWaitingForAddress();
    expect(() => complete(store, runId)).toThrow("waiting_for_user -> complete");
  });

  it("rejects retry while running", () => {
    const store = createInMemoryStore();
    const run = startRun(store, { projectId: "proj-1", goal: "g" });
    expect(() => retry(store, run.id)).toThrow("running -> running");
  });

  it("rejects a reply when the run is not waiting", () => {
    const store = createInMemoryStore();
    const run = startRun(store, { projectId: "proj-1", goal: "g" });
    expect(() => offerReply(store, run.id, { memberId: "zach", text: "10003" })).toThrow(
      "running -> running"
    );
  });

  it("rejects an unknown run id", () => {
    const store = createInMemoryStore();
    expect(() => complete(store, "missing")).toThrow("missing");
  });
});

describe("reattach and recovery", () => {
  it("returns the checkpoint and the pending question after waiting", () => {
    const { store, runId } = runWaitingForAddress();
    expect(reattach(store, runId)).toEqual({
      status: "waiting_for_user",
      pendingOperation: CART_STEP,
      missingFields: ["delivery_address"],
      lastError: null
    });
  });

  it("resumes at the checkpoint after failRecoverable then retry", () => {
    const store = createInMemoryStore();
    const run = startRun(store, { projectId: "proj-1", goal: "g" });
    checkpoint(store, run.id, CART_STEP);
    failRecoverable(store, run.id, "OpenAI timeout");
    expect(reattach(store, run.id)).toMatchObject({
      status: "failed_recoverable",
      lastError: "OpenAI timeout"
    });
    const resumed = retry(store, run.id);
    expect(resumed.status).toBe("running");
    expect(resumed.pending_operation_json).toEqual(CART_STEP);
    expect(reattach(store, run.id).lastError).toBeNull();
  });
});

describe("classifyAddressReply", () => {
  it.each(["10003", "5 york garden way north york on m6a 0g9", "also make the rug bigger"])("answers on %j with the text itself", (text) => {
    expect(classifyAddressReply(` ${text} `)).toEqual({ answers: true, value: text });
  });
});
