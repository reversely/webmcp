import type { BomItem, Candidate, Decision } from "../types";
import type { Budget } from "./events";
import { regenerateBom } from "./regenerate";
import type { ProjectStore } from "./store";

export class VersionMismatchError extends Error {
  constructor(expected: number, actual: number) {
    super(`project version ${actual} does not match expected ${expected}`);
    this.name = "VersionMismatchError";
  }
}

export type ReplaceRequest = {
  projectId: string;
  expectedVersion: number;
  oldItemId: string;
  newProductId: string;
  actor: string;
  now?: () => string;
};

export type ReplaceResult = {
  new_item_id: string;
  decision_id: string;
  version: number;
  budget: Budget;
};

/**
 * Swap one BOM item for another product as a single atomic step.
 *
 * Raises:
 *   VersionMismatchError: when the project version differs from `expectedVersion`.
 *   NotFoundError: when the project, old item, or new product is missing.
 */
export function replaceBomItem(store: ProjectStore, request: ReplaceRequest): ReplaceResult {
  const { projectId, expectedVersion, oldItemId, newProductId, actor } = request;
  return store.mutate(() => {
    const project = store.getProject(projectId);
    if (project.version !== expectedVersion) {
      throw new VersionMismatchError(expectedVersion, project.version);
    }
    const oldItem = store.getBomItem(oldItemId);
    if (oldItem.project_id !== projectId) throw new Error(`item ${oldItemId} belongs to another project`);
    store.getProduct(newProductId);

    store.markChanged(projectId);
    store.bomItems.set(oldItem.id, { ...oldItem, status: "removed" });
    ensureSelectedCandidate(store, projectId, newProductId, oldItem.category);
    // A product removed from the BOM earlier still owns a row, which regenerateBom skips; restore
    // it the way addToBom would so the replacement never creates a duplicate.
    const priorItem = findItemByProduct(store, projectId, newProductId);
    if (priorItem?.status === "removed") {
      store.bomItems.set(priorItem.id, { ...priorItem, status: "proposed" });
    }
    const { budget } = regenerateBom(store, projectId);
    const newItem = findItemByProduct(store, projectId, newProductId);
    if (!newItem) throw new Error(`regenerateBom inserted no item for product ${newProductId}`);

    for (const placement of store.placements.values()) {
      if (placement.bom_item_id === oldItem.id) {
        store.placements.set(placement.id, { ...placement, bom_item_id: newItem.id });
      }
    }

    const decision: Decision = {
      id: store.newId("dec"),
      project_id: projectId,
      actor,
      type: "product_replaced",
      payload_json: {
        old_item_id: oldItem.id,
        old_product_id: oldItem.product_id,
        new_item_id: newItem.id,
        new_product_id: newProductId
      },
      created_at: (request.now ?? (() => new Date().toISOString()))()
    };
    store.decisions.set(decision.id, decision);

    store.emit({
      type: "PRODUCT_REPLACED",
      project_id: projectId,
      old_item_id: oldItem.id,
      new_item_id: newItem.id,
      decision_id: decision.id
    });
    return {
      new_item_id: newItem.id,
      decision_id: decision.id,
      version: project.version + 1,
      budget
    };
  });
}

function ensureSelectedCandidate(
  store: ProjectStore,
  projectId: string,
  productId: string,
  category: Candidate["category"]
): void {
  for (const candidate of store.candidates.values()) {
    if (candidate.project_id !== projectId || candidate.product_id !== productId) continue;
    if (candidate.ranking_state !== "selected") {
      store.candidates.set(candidate.id, { ...candidate, ranking_state: "selected" });
    }
    return;
  }
  const candidate: Candidate = {
    id: store.newId("cand"),
    project_id: projectId,
    product_id: productId,
    category,
    hard_constraint_results_json: null,
    visual_evaluation_json: null,
    delivery_status: null,
    delivery_evidence_json: null,
    ranking_state: "selected",
    rank: null
  };
  store.candidates.set(candidate.id, candidate);
}

function findItemByProduct(store: ProjectStore, projectId: string, productId: string): BomItem | undefined {
  for (const item of store.bomItems.values()) {
    if (item.project_id === projectId && item.product_id === productId) return item;
  }
  return undefined;
}
