/**
 * The one filter grammar (PRD Section 7): a list of {field, op, value}, all of which must hold.
 * `field` is a structural path (status, role, attendance.<segment id>, party.size) or a
 * definition id, which reads the subject's value for that definition.
 */
import type { Guest, GuestStatus, Party } from "./types";

export const OPS = ["eq", "neq", "in", "not_in", "gt", "gte", "lt", "lte", "contains", "present", "missing"] as const;
export type Op = (typeof OPS)[number];
export type FilterClause = { field: string; op: Op; value?: unknown };
export type Filter = FilterClause[];

export type Subject = {
  guest: Guest;
  party: Party | null;
  /** The guest's values by definition id; a party-scoped value appears under its definition id too. */
  values: Record<string, unknown>;
};

function read(subject: Subject, field: string): unknown {
  if (field === "status") return subject.guest.status satisfies GuestStatus;
  if (field === "role") return subject.guest.role;
  if (field === "party.size") return subject.party?.guest_ids.length ?? 1;
  if (field.startsWith("attendance.")) return subject.guest.attendance[field.slice("attendance.".length)] ?? false;
  return subject.values[field];
}

function holds(actual: unknown, clause: FilterClause): boolean {
  const { op, value } = clause;
  const present = actual !== undefined && actual !== null && actual !== "" && !(Array.isArray(actual) && actual.length === 0);
  switch (op) {
    case "present":
      return present;
    case "missing":
      return !present;
    case "eq":
      return Array.isArray(actual) ? actual.includes(value) : actual === value;
    case "neq":
      return Array.isArray(actual) ? !actual.includes(value) : actual !== value;
    case "in":
      return Array.isArray(value) && (Array.isArray(actual) ? actual.some((a) => value.includes(a)) : value.includes(actual));
    case "not_in":
      return Array.isArray(value) && (Array.isArray(actual) ? !actual.some((a) => value.includes(a)) : !value.includes(actual));
    case "contains":
      return Array.isArray(actual) ? actual.includes(value) : typeof actual === "string" && typeof value === "string" && actual.toLowerCase().includes(value.toLowerCase());
    case "gt":
      return typeof actual === "number" && typeof value === "number" && actual > value;
    case "gte":
      return typeof actual === "number" && typeof value === "number" && actual >= value;
    case "lt":
      return typeof actual === "number" && typeof value === "number" && actual < value;
    case "lte":
      return typeof actual === "number" && typeof value === "number" && actual <= value;
  }
}

/** True when every clause holds for the subject. An empty filter matches everyone. */
export function matches(filter: Filter, subject: Subject): boolean {
  return filter.every((clause) => holds(read(subject, clause.field), clause));
}

/** Parses a filter from JSON or a query string form `field:op:value;field:op:value`; a bad clause throws with its position. */
export function parseFilter(input: unknown): Filter {
  if (input === undefined || input === null || input === "") return [];
  if (typeof input === "string") {
    if (input.trim().startsWith("[")) return parseFilter(JSON.parse(input));
    return input.split(";").filter(Boolean).map((part, i) => {
      const [field, op, ...rest] = part.split(":");
      if (!field || !OPS.includes(op as Op)) throw new Error(`Filter clause ${i + 1} needs field:op[:value]; ops are ${OPS.join(", ")}.`);
      const raw = rest.join(":");
      const value = raw === "" ? undefined : raw === "true" ? true : raw === "false" ? false : /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw.includes(",") ? raw.split(",") : raw;
      return { field, op: op as Op, value };
    });
  }
  if (!Array.isArray(input)) throw new Error("A filter is a list of {field, op, value}.");
  return input.map((clause, i) => {
    const c = clause as Partial<FilterClause>;
    if (!c || typeof c.field !== "string" || !OPS.includes(c.op as Op)) throw new Error(`Filter clause ${i + 1} needs field and op; ops are ${OPS.join(", ")}.`);
    return { field: c.field, op: c.op as Op, value: c.value };
  });
}
