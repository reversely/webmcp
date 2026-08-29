/**
 * Storage and clock boundary for agent runs. The transitions in `transitions.ts` are pure over this
 * interface; the in-memory implementation here backs tests and local experiments.
 */
import type { AgentRun } from "../types";

export type Clock = () => Date;

export interface AgentWaitingForUserEvent {
  type: "AGENT_WAITING_FOR_USER";
  runId: string;
  projectId: string;
  field: string;
  question: string;
}

export type AgentRunEvent = AgentWaitingForUserEvent;

export interface AgentRunStore {
  now: Clock;
  nextId(): string;
  get(runId: string): AgentRun | undefined;
  put(run: AgentRun): void;
  emit(event: AgentRunEvent): void;
  /** Sets or clears the last recoverable error for a run. */
  setFailure(runId: string, error: string | null): void;
  getFailure(runId: string): string | null;
}

export interface InMemoryStoreOptions {
  clock?: Clock;
  idPrefix?: string;
}

export interface InMemoryAgentRunStore extends AgentRunStore {
  readonly events: readonly AgentRunEvent[];
}

export function createInMemoryStore(options: InMemoryStoreOptions = {}): InMemoryAgentRunStore {
  const clock = options.clock ?? (() => new Date());
  const idPrefix = options.idPrefix ?? "run";
  const runs = new Map<string, AgentRun>();
  const failures = new Map<string, string>();
  const events: AgentRunEvent[] = [];
  let counter = 0;

  return {
    now: clock,
    events,
    nextId: () => `${idPrefix}-${++counter}`,
    get: (runId) => runs.get(runId),
    put: (run) => {
      runs.set(run.id, run);
    },
    emit: (event) => {
      events.push(event);
    },
    setFailure: (runId, error) => {
      if (error === null) failures.delete(runId);
      else failures.set(runId, error);
    },
    getFailure: (runId) => failures.get(runId) ?? null
  };
}
