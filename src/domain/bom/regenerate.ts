import type { BomItem } from "../types";
import { calculateBudget } from "./budget";
import type { Budget } from "./events";
import type { ProjectStore } from "./store";

export type RegenerateResult = { inserted_item_ids: string[]; budget: Budget };

/**
 * Insert a `proposed` item for every selected candidate that has no BOM item, then recalculate.
 *
 * A candidate whose product already has an item in any status is skipped, so a `removed` item
 * stays removed until `addToBom` restores it. Nothing is ever deleted or moved.
 */
export function regenerateBom(store: ProjectStore, projectId: string): RegenerateResult {
  return store.mutate(() => {
    const covered = new Set<string>();
    for (const item of store.bomItems.values()) {
      if (item.project_id === projectId) covered.add(item.product_id);
    }

    const inserted: string[] = [];
    for (const candidate of store.candidates.values()) {
      if (candidate.project_id !== projectId || candidate.ranking_state !== "selected") continue;
      if (covered.has(candidate.product_id)) continue;
      const item: BomItem = {
        id: store.newId("bom"),
        project_id: projectId,
        product_id: candidate.product_id,
        category: candidate.category,
        quantity: 1,
        status: "proposed"
      };
      store.bomItems.set(item.id, item);
      covered.add(item.product_id);
      inserted.push(item.id);
    }
    if (inserted.length > 0) store.markChanged(projectId);

    const budget = calculateBudget(store, projectId);
    store.emit({ type: "BOM_REGENERATED", project_id: projectId, inserted_item_ids: inserted, budget });
    if (budget.state === "over") store.emit({ type: "BUDGET_VIOLATED", project_id: projectId, budget });
    return { inserted_item_ids: inserted, budget };
  });
}
