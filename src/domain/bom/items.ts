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

export function removeFromBom(store: ProjectStore, bomItemId: string): boolean {
  const item = store.getBomItem(bomItemId);
  return store.mutate(() => {
    if (item.status === "removed") return false;
    setStatus(store, item, "removed");
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
