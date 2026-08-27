import type { Budget } from "./events";
import type { ProjectStore } from "./store";

/** Sum price × quantity over the project's `proposed` and `approved` items against its budget. */
export function calculateBudget(store: ProjectStore, projectId: string): Budget {
  const project = store.getProject(projectId);
  let committed = 0;
  for (const item of store.bomItems.values()) {
    if (item.project_id !== projectId || item.status === "removed") continue;
    committed += store.getProduct(item.product_id).price_cents * item.quantity;
  }
  const overage = Math.max(0, committed - project.budget_cents);
  const state = overage > 0 ? "over" : committed === project.budget_cents ? "exact" : "under";
  return { committed_cents: committed, budget_cents: project.budget_cents, state, overage_cents: overage };
}
