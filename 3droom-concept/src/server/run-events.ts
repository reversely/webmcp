/**
 * The event source behind the streaming chat route (#19). While a message runs, the trace and the
 * message list are the two places the run leaves marks: every tool call opens and closes a `tool`
 * span, and every message or artifact the run writes lands in the project's message list. Both
 * announce each write (onSpanWrite, onMessageWrite), so this turns the writes into events in the
 * order they happen, and the agent code never learns about the connection.
 */
import { onMessageWrite, type ChatMessage } from "./state";
import { onSpanWrite, type SpanStatus } from "./trace";

export type ToolEvent = { id: string; name: string; status: SpanStatus; started_at: string; duration_ms?: number; error?: string };

export type RunEvent =
  /** A message without an artifact, new or with new text: the user's own line, or an assistant reply. */
  | { type: "text"; message: ChatMessage }
  /** A tool span opened (status running) or closed (ok, error). */
  | { type: "tool"; tool: ToolEvent }
  /** A message carrying a sourcing or ranking artifact, created or updated in place. */
  | { type: "artifact"; message: ChatMessage }
  /** A message carrying a question artifact: the run is waiting for the next message. */
  | { type: "question"; message: ChatMessage }
  | { type: "done"; messages: ChatMessage[] }
  | { type: "error"; error: string };

function classify(m: ChatMessage): RunEvent {
  if (!m.artifact) return { type: "text", message: m };
  return { type: m.artifact.kind === "question" ? "question" : "artifact", message: m };
}

/**
 * Runs `run` and emits every span and message write for `projectId` as it happens, then `done`
 * with the messages `run` returned, or `error` when it threw. Writes from another request on the
 * same project during the run (the other person's message, a 3D job) stream too; the receiver
 * treats them like any other update.
 */
export async function streamRun(projectId: string, run: () => Promise<ChatMessage[]>, emit: (event: RunEvent) => void): Promise<void> {
  const stopSpans = onSpanWrite((sp) => {
    if (sp.project_id !== projectId || sp.kind !== "tool") return;
    emit({ type: "tool", tool: { id: sp.id, name: sp.name, status: sp.status, started_at: sp.started_at, ...(sp.duration_ms !== undefined ? { duration_ms: sp.duration_ms } : {}), ...(sp.error ? { error: sp.error } : {}) } });
  });
  const stopMessages = onMessageWrite((pid, m) => {
    if (pid === projectId) emit(classify(m));
  });
  try {
    const messages = await run();
    emit({ type: "done", messages });
  } catch (e) {
    emit({ type: "error", error: e instanceof Error ? e.message : String(e) });
  } finally {
    stopSpans();
    stopMessages();
  }
}
