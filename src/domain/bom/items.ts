import type { BomItem } from "../types";
import { regenerateBom } from "./regenerate";
import type { ProjectStore } from "./store";

function setStatus(store: ProjectStore, item: BomItem, status: BomItem["status"]): void {
  store.bomItems.set(item.id, { ...item, status });
  store.markChanged(item.project_id);
}

/** Restore a `removed` item to `proposed`. A `proposed` or `approved` item is left as it is. */
export function addToBom(store: ProjectStore, bomItemId: string): boolean {
  const item = store.getBomItem(bomItemId);
  return store.mutate(() => {
    if (item.status !== "removed") return false;
    setStatus(store, item, "proposed");
    regenerateBom(store, item.project_id);
    return true;
  });
}

/** Marks an item `removed` and drops its placement: a removed line has no place on the plan. */
export function removeFromBom(store: ProjectStore, bomItemId: string): boolean {
  const item = store.getBomItem(bomItemId);
  return store.mutate(() => {
    if (item.status === "removed") return false;
    setStatus(store, item, "removed");
    for (const placement of store.placements.values()) {
      if (placement.bom_item_id === item.id) store.placements.delete(placement.id);
    }
    regenerateBom(store, item.project_id);
    return true;
  });
}

export function approveBomItem(store: ProjectStore, bomItemId: string): boolean {
  const item = store.getBomItem(bomItemId);
  return store.mutate(() => {
    if (item.status !== "proposed") return false;
    setStatus(store, item, "approved");
    return true;
  });
}
