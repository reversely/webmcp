/**
 * One-requirement writes (#60): a stated item, rule, or palette lands as a single agreed row
 * without touching the other rows. PUT /spec keeps its replace-all semantics for the plan form.
 */
import { itemKey, readLayoutRule, readRequiredItem, type LayoutRule, type Requirement } from "../domain/types";
import { appState, snapshot } from "./state";

export type RequirementWrite = {
  type: Requirement["type"];
  value: unknown;
  created_by: string;
  /** Where the statement came from: "chat" for the agent, "webmcp" for the tool; defaults to "chat". */
  source?: string;
  scope?: string;
};

export type RequirementUpsert = { requirement: Requirement; created: boolean };

export class RequirementValueError extends Error {}

/** Identity of a rule: its relation, subject, and objects by item key, order kept as stated. */
function ruleKey(rule: LayoutRule): string {
  if (rule.relation === "text") return `text:${itemKey(rule.text)}`;
  return `${rule.relation}:${itemKey(rule.subject)}:${rule.objects.map(itemKey).join(",")}`;
}

/** Spells a name the way an agreed required_item already spells it, so rules and items agree. */
function canonicalName(projectId: string, name: string): string {
  for (const row of snapshot(projectId).requirements) {
    if (row.type !== "required_item" || row.status !== "agreed") continue;
    const item = readRequiredItem(row.value_json);
    if (item && itemKey(item.name) === itemKey(name)) return item.name;
  }
  return name.trim();
}

/** Reads the value for its type; throws RequirementValueError when it has no readable shape. */
function readValue(projectId: string, type: Requirement["type"], value: unknown): { value: unknown; key: string } {
  if (type === "required_item") {
    const item = readRequiredItem(value);
    if (!item) throw new RequirementValueError("A required_item needs a name: a string or {name, kind}.");
    return { value: item, key: itemKey(item.name) };
  }
  if (type === "layout_requirement") {
    const rule = readLayoutRule(value);
    if (!rule) throw new RequirementValueError("A layout_requirement needs {relation, subject, objects} or a sentence.");
    const resolved: LayoutRule = rule.relation === "text" ? rule : { ...rule, subject: canonicalName(projectId, rule.subject), objects: rule.objects.map((o) => canonicalName(projectId, o)) };
    return { value: resolved, key: ruleKey(resolved) };
  }
  if (!value || typeof value !== "object") throw new RequirementValueError("A visual_direction needs {base: [hex], accent: [hex]}.");
  return { value, key: "visual_direction" };
}

/**
 * Appends one agreed requirement, or updates the agreed row with the same key: a required_item by
 * its name, a layout_requirement by relation, subject, and objects, and the single visual_direction
 * row. Every other row keeps its status. A required_item update keeps the known kind when the new
 * value carries none.
 */
export function upsertRequirement(projectId: string, write: RequirementWrite): RequirementUpsert {
  const s = appState();
  const { value, key } = readValue(projectId, write.type, write.value);
  const keyOf = (row: Requirement): string | null => {
    try {
      return readValue(projectId, row.type, row.value_json).key;
    } catch {
      return null;
    }
  };
  const existing = snapshot(projectId).requirements.find((r) => r.type === write.type && r.status === "agreed" && keyOf(r) === key);
  if (existing) {
    const merged =
      write.type === "required_item"
        ? { ...(value as { name: string; kind: string | null }), kind: (value as { kind: string | null }).kind ?? readRequiredItem(existing.value_json)?.kind ?? null }
        : value;
    const row: Requirement = { ...existing, value_json: merged, created_by: write.created_by };
    s.requirements.set(row.id, row);
    return { requirement: row, created: false };
  }
  const row: Requirement = {
    id: s.store.newId("req"),
    project_id: projectId,
    scope: write.scope?.trim() || "project",
    type: write.type,
    value_json: value,
    status: "agreed",
    source: write.source ?? "chat",
    created_by: write.created_by
  };
  s.requirements.set(row.id, row);
  return { requirement: row, created: true };
}
