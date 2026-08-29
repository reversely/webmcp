/**
 * State machine over `AgentRun`. Each function loads a run from the store, checks the transition
 * is legal for its current status, writes the new row, and returns it.
 */
import type { AgentRun } from "../types";
import { classifyReply, type ReplyClassifier } from "./classify";
import type { AgentRunStore } from "./store";

type Status = AgentRun["status"];

export class IllegalTransitionError extends Error {
  constructor(action: string, from: Status, to: Status, allowedFrom: readonly Status[]) {
    super(
      `Cannot ${action} agent run: transition ${from} -> ${to} is illegal; ${action} requires ` +
        `status ${allowedFrom.join(" or ")}`
    );
    this.name = "IllegalTransitionError";
  }
}

export class AgentRunNotFoundError extends Error {
  constructor(runId: string) {
    super(`Agent run ${runId} not found`);
    this.name = "AgentRunNotFoundError";
  }
}

function load(store: AgentRunStore, runId: string): AgentRun {
  const run = store.get(runId);
  if (!run) throw new AgentRunNotFoundError(runId);
  return run;
}

function transition(
  store: AgentRunStore,
  runId: string,
  action: string,
  allowedFrom: readonly Status[],
  to: Status,
  patch: (run: AgentRun) => Partial<AgentRun> = () => ({})
): AgentRun {
  const run = load(store, runId);
  if (!allowedFrom.includes(run.status)) {
    throw new IllegalTransitionError(action, run.status, to, allowedFrom);
  }
  const next: AgentRun = { ...run, ...patch(run), status: to };
  store.put(next);
  return next;
}

export function startRun(store: AgentRunStore, input: { projectId: string; goal: string }): AgentRun {
  const run: AgentRun = {
    id: store.nextId(),
    project_id: input.projectId,
    goal: input.goal,
    status: "running",
    missing_fields_json: [],
    pending_operation_json: null,
    started_at: store.now().toISOString(),
    completed_at: null
  };
  store.put(run);
  return run;
}

/** Records the resume point after a tool result. */
export function checkpoint(store: AgentRunStore, runId: string, pendingOperation: unknown): AgentRun {
  return transition(store, runId, "checkpoint", ["running"], "running", () => ({
    pending_operation_json: pendingOperation
  }));
}

export function requestInput(
  store: AgentRunStore,
  runId: string,
  input: { field: string; question: string }
): AgentRun {
  const run = transition(store, runId, "requestInput", ["running"], "waiting_for_user", () => ({
    missing_fields_json: [input.field]
  }));
  store.emit({
    type: "AGENT_WAITING_FOR_USER",
    runId: run.id,
    projectId: run.project_id,
    field: input.field,
    question: input.question
  });
  return run;
}

export type ReplyOutcome =
  | { answered: true; field: string; value: unknown; memberId: string; run: AgentRun }
  | { answered: false; treatedAsNewRequest: true; memberId: string; run: AgentRun };

/**
 * Offers a project member's chat message as the answer to the pending question.
 *
 * Returns the classified value for the caller to persist when the message answers; otherwise the
 * run keeps waiting and the caller should route the message as a new request.
 */
export function offerReply(
  store: AgentRunStore,
  runId: string,
  reply: { memberId: string; text: string },
  classify: ReplyClassifier = classifyReply
): ReplyOutcome {
  const run = load(store, runId);
  if (run.status !== "waiting_for_user") {
    throw new IllegalTransitionError("offerReply", run.status, "running", ["waiting_for_user"]);
  }
  const [field] = run.missing_fields_json;
  if (field === undefined) throw new Error(`Agent run ${runId} is waiting with no missing field`);

  const verdict = classify(reply.text, field);
  if (!verdict.answers) {
    return { answered: false, treatedAsNewRequest: true, memberId: reply.memberId, run };
  }
  const resumed = transition(store, runId, "offerReply", ["waiting_for_user"], "running", () => ({
    missing_fields_json: []
  }));
  return { answered: true, field, value: verdict.value, memberId: reply.memberId, run: resumed };
}

export function complete(store: AgentRunStore, runId: string): AgentRun {
  return transition(store, runId, "complete", ["running"], "complete", () => ({
    completed_at: store.now().toISOString()
  }));
}

export function failRecoverable(store: AgentRunStore, runId: string, error: string): AgentRun {
  const run = transition(store, runId, "failRecoverable", ["running"], "failed_recoverable");
  store.setFailure(runId, error);
  return run;
}

/** Resumes a recoverable failure at its last checkpoint. */
export function retry(store: AgentRunStore, runId: string): AgentRun {
  const run = transition(store, runId, "retry", ["failed_recoverable"], "running");
  store.setFailure(runId, null);
  return run;
}

export interface Reattachment {
  status: Status;
  pendingOperation: unknown;
  missingFields: string[];
  lastError: string | null;
}

/** What a reconnecting client needs to re-attach to a run in progress. */
export function reattach(store: AgentRunStore, runId: string): Reattachment {
  const run = load(store, runId);
  return {
    status: run.status,
    pendingOperation: run.pending_operation_json,
    missingFields: run.missing_fields_json,
    lastError: store.getFailure(runId)
  };
}
