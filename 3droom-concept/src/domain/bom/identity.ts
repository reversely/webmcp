import { itemKey, type BomItem, type Kind, type LayoutRule } from "../types";
import type { ProjectStore } from "./store";

export type RenameResult = { item: BomItem; old_name: string; name: string };

/**
 * Renames an item (PRD 20). The item's phrase is the key the BOM, the candidates, and the layout
 * rules share, so every candidate and BOM item in the project that answers to the old phrase
 * takes the new one. A name that differs only in case or spacing is still written as given.
 *
 * Raises:
 *   Error: when the name is empty.
 *   NotFoundError: when the item is missing.
 */
export function renameItem(store: ProjectStore, bomItemId: string, name: string): RenameResult {
  const next = name.trim();
  if (!next) throw new Error("An item needs a name");
  const item = store.getBomItem(bomItemId);
  const oldKey = itemKey(item.category);
  return store.mutate(() => {
    for (const row of store.bomItems.values()) {
      if (row.project_id === item.project_id && itemKey(row.category) === oldKey) store.bomItems.set(row.id, { ...row, category: next });
    }
    for (const row of store.candidates.values()) {
      if (row.project_id === item.project_id && itemKey(row.category) === oldKey) store.candidates.set(row.id, { ...row, category: next });
    }
    store.markChanged(item.project_id);
    return { item: store.getBomItem(bomItemId), old_name: item.category, name: next };
  });
}

/**
 * Changes an item's rendering kind (PRD 20). The candidate carrying the same product follows, so
 * the catalog table and the plan agree on the proxy shape.
 */
export function setItemKind(store: ProjectStore, bomItemId: string, kind: Kind): BomItem {
  const item = store.getBomItem(bomItemId);
  return store.mutate(() => {
    store.bomItems.set(item.id, { ...item, kind });
    for (const row of store.candidates.values()) {
      if (row.project_id === item.project_id && row.product_id === item.product_id) store.candidates.set(row.id, { ...row, kind });
    }
    store.markChanged(item.project_id);
    return store.getBomItem(bomItemId);
  });
}

/** A layout rule with every reference to `oldName` (case-insensitive) replaced by `name`; a text rule is returned as is. */
export function renameItemInRule(rule: LayoutRule, oldName: string, name: string): LayoutRule {
  if (rule.relation === "text") return rule;
  const key = itemKey(oldName);
  const swap = (n: string) => (itemKey(n) === key ? name : n);
  return { ...rule, subject: swap(rule.subject), objects: rule.objects.map(swap) };
}
