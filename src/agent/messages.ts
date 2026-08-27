/**
 * Routing for one incoming project chat message (PRD 5.2, 8.5): a waiting run gets the message
 * as a candidate answer first; a pending replacement takes an approval; everything else goes to
 * the PlanningAgent. Kept out of the Next route so tests can drive it without HTTP.
 */
import { offerReply } from "../domain/agent-run";
import { hasDestination } from "../domain/delivery";
import { formatMoney } from "../domain/money";
import type { DeliveryAddress } from "../domain/types";
import { appState, pushMessage, setDeliveryAddress, snapshot, type ChatMessage } from "../server/state";
import { recordIssue, withProject, withSpan } from "../server/trace";
import { resolveAddress } from "./address";
import { hasModelKey } from "./model";
import { runPlanningAgent } from "./planning-agent";
import { approvalIndex, approveReplacement, type ReplacedLine } from "./replacement";
import { resumeSourcing, type SourcingDeps, type SourcingOutcome } from "./sourcing";

export type MessageDeps = {
  /** Sourcing dependencies for a resumed run; tests inject fakes, production uses the defaults. */
  sourcing?: SourcingDeps;
  runAgent?: (ctx: { projectId: string; author: string }, history: ChatMessage[], text: string) => Promise<string>;
};

function formatAddress(address: DeliveryAddress): string {
  return [address.line1, address.city, address.region, address.postal_code].filter(Boolean).join(", ");
}

function summarizeOutcome(outcome: SourcingOutcome): string {
  const s = appState();
  if (outcome.status === "waiting_for_user") return outcome.question;
  if (outcome.status === "no_match") return `I could not find a combination inside the budget for ${outcome.categories.join(", ")}.`;
  const picks = Object.entries(outcome.selected).map(([category, productId]) => {
    const product = s.store.products.get(productId!);
    return `${category}: ${product?.title ?? productId} (${formatMoney(product?.price_cents ?? 0, product?.currency)})`;
  });
  return `Selected ${picks.join("; ")}. Subtotal ${formatMoney(outcome.subtotal_cents)}.${outcome.layout_checked ? " Layout placed and checked." : ""}`;
}

/** "Replaced with X." for one line; each line named with its product when the approval replaced several (#64). */
function replacedText(replaced: ReplacedLine[]): string {
  const title = (line: ReplacedLine) => appState().store.products.get(line.product_id)?.title ?? line.product_id;
  if (replaced.length === 1) return `Replaced with ${title(replaced[0])}.`;
  return `Replaced ${replaced.map((line) => `the ${line.category} with ${title(line)}`).join(" and ")}.`;
}

/** Handles one message end to end and returns the project's message list. */
export function handleMessage(projectId: string, author: string, text: string, deps: MessageDeps = {}): Promise<ChatMessage[]> {
  return withProject(projectId, () => routeMessage(projectId, author, text, deps));
}

async function routeMessage(projectId: string, author: string, text: string, deps: MessageDeps): Promise<ChatMessage[]> {
  const s = appState();
  pushMessage(projectId, { role: "user", author, text });

  const runId = s.activeRuns.get(projectId);
  const run = runId ? s.runs.get(runId) : undefined;
  if (run && run.status === "waiting_for_user") {
    const outcome = offerReply(s.runs, run.id, { memberId: author, text });
    if (outcome.answered) {
      const address = await resolveAddress(text);
      setDeliveryAddress(projectId, address);
      const line = hasDestination(address)
        ? `Checking delivery to ${formatAddress(address)}.`
        : "Stored the reply as the address line; checking delivery without a destination.";
      pushMessage(projectId, { role: "agent", author: "PlanningAgent", text: line });
      const result = await resumeSourcing(projectId, run.id, deps.sourcing);
      pushMessage(projectId, { role: "agent", author: "PlanningAgent", text: summarizeOutcome(result) });
      return snapshot(projectId).messages;
    }
  }

  const approval = approvalIndex(text);
  if (approval !== null && s.pendingReplacements.has(projectId)) {
    const result = await withSpan(projectId, { kind: "domain", name: "approve_replacement", prd_ref: "PRD 8.5", input: { index: approval, author } }, () => approveReplacement(projectId, approval, author));
    const reply =
      result.status === "replaced"
        ? `${replacedText(result.replaced)} Committed ${formatMoney(result.result.budget.committed_cents)} (${result.result.budget.state}).`
        : result.status === "stale_version"
          ? `The project changed while the ranking was open (${result.message}); nothing was replaced.`
          : "There is no ranked replacement to approve.";
    pushMessage(projectId, { role: "agent", author: "PlanningAgent", text: reply });
    return snapshot(projectId).messages;
  }

  const runAgent = deps.runAgent ?? ((ctx: { projectId: string; author: string }, history: ChatMessage[], text: string) => runPlanningAgent(ctx, history, text, { sourcing: deps.sourcing }));
  if (!deps.runAgent && !hasModelKey()) {
    pushMessage(projectId, { role: "agent", author: "PlanningAgent", text: "No OPENAI_API_KEY is set, so the PlanningAgent cannot run. Use the search panel to source products directly." });
    return snapshot(projectId).messages;
  }
  const history = snapshot(projectId).messages.slice(0, -1);
  let reply: string;
  try {
    reply = await runAgent({ projectId, author }, history, text);
  } catch (e) {
    // A model timeout or 5xx inside the SDK run must not turn into a 500: the message list comes
    // back with a reply that says what failed, and the person sends the message again (PRD 17).
    const message = e instanceof Error ? e.message : String(e);
    recordIssue(projectId, { source: "agent_run PlanningAgent", severity: "error", message: `The PlanningAgent turn for "${text.slice(0, 80)}" failed (${message}); nothing was recorded for it, so send the message again to retry.` });
    pushMessage(projectId, { role: "agent", author: "PlanningAgent", text: `The planning step failed (${message}). Send the message again to retry; the plan and the search panel keep working meanwhile.` });
    return snapshot(projectId).messages;
  }
  const activeId = s.activeRuns.get(projectId);
  const nowWaiting = activeId !== undefined && s.runs.get(activeId)?.status === "waiting_for_user";
  // A paused run already posted its question as an artifact message; a second copy would repeat it.
  if (reply.trim() && !nowWaiting) pushMessage(projectId, { role: "agent", author: "PlanningAgent", text: reply });
  return snapshot(projectId).messages;
}
