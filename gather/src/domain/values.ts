/**
 * Validation and aggregation switch on a definition's value type and read everything else from
 * the row (PRD Section 7). A value that fails returns the reason a guest or an agent can act on.
 */
import type { AttributeDefinition, Option } from "./types";

export type Validation = { ok: true; value: unknown } | { ok: false; reason: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;

function optionValues(def: AttributeDefinition): string[] {
  return (def.constraints.options ?? []).map((o) => o.value);
}

/** Checks `raw` against the definition and returns the stored form. */
export function validateValue(def: AttributeDefinition, raw: unknown): Validation {
  const c = def.constraints;
  switch (def.value_type) {
    case "text": {
      if (typeof raw !== "string") return { ok: false, reason: `${def.label} needs text.` };
      const value = raw.trim();
      if (c.max_length !== undefined && value.length > c.max_length) return { ok: false, reason: `${def.label} allows ${c.max_length} characters; this has ${value.length}.` };
      if (c.pattern && !new RegExp(c.pattern).test(value)) return { ok: false, reason: `${def.label} does not match the required form.` };
      return { ok: true, value };
    }
    case "number": {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (typeof raw === "boolean" || raw === "" || raw === null || Number.isNaN(n)) return { ok: false, reason: `${def.label} needs a number.` };
      if (c.min !== undefined && n < c.min) return { ok: false, reason: `${def.label} must be at least ${c.min}.` };
      if (c.max !== undefined && n > c.max) return { ok: false, reason: `${def.label} must be at most ${c.max}.` };
      return { ok: true, value: n };
    }
    case "boolean": {
      if (typeof raw === "boolean") return { ok: true, value: raw };
      if (raw === "true" || raw === "false") return { ok: true, value: raw === "true" };
      return { ok: false, reason: `${def.label} needs yes or no.` };
    }
    case "enum": {
      const values = optionValues(def);
      if (typeof raw !== "string" || !values.includes(raw)) return { ok: false, reason: `${def.label} must be one of: ${values.join(", ")}.` };
      return { ok: true, value: raw };
    }
    case "multi_enum": {
      const values = optionValues(def);
      if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string" || !values.includes(v))) return { ok: false, reason: `${def.label} takes any of: ${values.join(", ")}.` };
      return { ok: true, value: [...new Set(raw as string[])] };
    }
    case "date": {
      if (typeof raw !== "string" || !ISO_DATE.test(raw) || Number.isNaN(Date.parse(raw))) return { ok: false, reason: `${def.label} needs a date.` };
      return { ok: true, value: raw };
    }
    case "file": {
      if (typeof raw !== "string" || !/^(https?:\/\/|data:|\/)/.test(raw)) return { ok: false, reason: `${def.label} needs a file address.` };
      return { ok: true, value: raw };
    }
    case "reference": {
      if (typeof raw !== "string" || !raw.trim()) return { ok: false, reason: `${def.label} needs the id of the record it points to.` };
      return { ok: true, value: raw.trim() };
    }
  }
}

export type Aggregate =
  | { value_type: "enum" | "multi_enum"; counts: { option: Option; count: number }[]; missing: number }
  | { value_type: "number"; sum: number; count: number; buckets: { from: number; to: number; count: number }[]; missing: number }
  | { value_type: "boolean"; true: number; false: number; missing: number }
  | { value_type: "text" | "date" | "file" | "reference"; present: number; missing: number };

/** Aggregates values for one definition: per-option counts, sum and quartile buckets, true and false counts, or a presence count. */
export function aggregate(def: AttributeDefinition, values: (unknown | undefined)[]): Aggregate {
  const present = values.filter((v) => v !== undefined && v !== null && v !== "");
  const missing = values.length - present.length;
  switch (def.value_type) {
    case "enum":
    case "multi_enum": {
      const counts = (def.constraints.options ?? []).map((option) => ({ option, count: present.filter((v) => (Array.isArray(v) ? v.includes(option.value) : v === option.value)).length }));
      return { value_type: def.value_type, counts, missing };
    }
    case "number": {
      const nums = present.map(Number).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
      const sum = nums.reduce((s, n) => s + n, 0);
      const buckets: { from: number; to: number; count: number }[] = [];
      if (nums.length > 0) {
        const q = (p: number) => nums[Math.min(nums.length - 1, Math.floor(p * nums.length))];
        const edges = [nums[0], q(0.25), q(0.5), q(0.75), nums[nums.length - 1]];
        for (let i = 0; i < 4; i++) buckets.push({ from: edges[i], to: edges[i + 1], count: nums.filter((n) => (i === 3 ? n >= edges[i] && n <= edges[i + 1] : n >= edges[i] && n < edges[i + 1])).length });
      }
      return { value_type: "number", sum, count: nums.length, buckets, missing };
    }
    case "boolean":
      return { value_type: "boolean", true: present.filter((v) => v === true).length, false: present.filter((v) => v === false).length, missing };
    default:
      return { value_type: def.value_type, present: present.length, missing };
  }
}

/** The form control a value type renders as; the page reads this, never the type name. */
export function controlFor(def: AttributeDefinition): "text" | "textarea" | "number" | "checkbox" | "radio" | "checkboxes" | "date" | "file" | "select" {
  switch (def.value_type) {
    case "text":
      return (def.constraints.max_length ?? 0) > 120 ? "textarea" : "text";
    case "number":
      return "number";
    case "boolean":
      return "checkbox";
    case "enum":
      return (def.constraints.options?.length ?? 0) > 6 ? "select" : "radio";
    case "multi_enum":
      return "checkboxes";
    case "date":
      return "date";
    case "file":
      return "file";
    case "reference":
      return "select";
  }
}
