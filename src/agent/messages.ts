/**
 * Routing for one incoming project chat message (PRD 5.2, 8.5): a waiting run gets the message
 * as a candidate answer first; a pending replacement takes an approval; everything else goes to
 * the PlanningAgent. Kept out of the Next route so tests can drive it without HTTP.
 */
import { offerReply } from "../domain/agent-run";
import { inferAddress } from "../domain/delivery";
import { formatMoney } from "../domain/money";
import type { DeliveryAddress } from "../domain/types";
import { appState, pushMessage, setDeliveryAddress, snapshot, type ChatMessage } from "../server/state";
import { recordIssue, withProject, withSpan } from "../server/trace";
import { hasModelKey } from "./model";
import { runPlanningAgent } from "./planning-agent";
import { approvalIndex, approveReplacement } from "./replacement";
import { resumeSourcing, type SourcingDeps, type SourcingOutcome } from "./sourcing";

export type MessageDeps = {
  /** Sourcing dependencies for a resumed run; tests inject fakes, production uses the defaults. */
  sourcing?: SourcingDeps;
  runAgent?: (ctx: { projectId: string; author: string }, history: ChatMessage[], text: string) => Promise<string>;
};

function formatAddress(address: DeliveryAddress): string {
  return [address.line1, address.city, address.region, address.postal_code].filter(Boolean).join(", ");
}

/** A full address line is preferred; the classifier's bare ZIP is the fallback. */
function addressFrom(projectId: string, text: string, zip: unknown): DeliveryAddress {
  try {
    return inferAddress(text);
  } catch (e) {
    try {
      const address = inferAddress(String(zip));
      recordIssue(projectId, { source: "domain infer_address", message: `The reply "${text.slice(0, 80)}" did not parse as a street address (${(e as Error).message}); only the ZIP ${address.postal_code} is stored, so checkouts use a placeholder street and the evidence is marked address_partial.` });
      return address;
    } catch (inner) {
      recordIssue(projectId, { source: "domain infer_address", severity: "error", message: `No delivery address could be read from "${text.slice(0, 80)}" (${(inner as Error).message}); reply with a ZIP code or a full US address to continue the sourcing run.` });
      throw inner;
    }
  }
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
      const address = addressFrom(projectId, text, outcome.value);
      setDeliveryAddress(projectId, address);
      pushMessage(projectId, { role: "agent", author: "PlanningAgent", text: `Checking delivery to ${formatAddress(address)}.` });
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
        ? `Replaced with ${s.store.products.get(result.product_id)?.title ?? result.product_id}. Committed ${formatMoney(result.result.budget.committed_cents)} (${result.result.budget.state}).`
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
  const reply = await runAgent({ projectId, author }, history, text);
  const activeId = s.activeRuns.get(projectId);
  const nowWaiting = activeId !== undefined && s.runs.get(activeId)?.status === "waiting_for_user";
  // A paused run already posted its question as an artifact message; a second copy would repeat it.
  if (reply.trim() && !nowWaiting) pushMessage(projectId, { role: "agent", author: "PlanningAgent", text: reply });
  return snapshot(projectId).messages;
}
