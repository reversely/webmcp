/** Per-unit validation against the design's fields (PRD Section 5, validate_units): the issues a buyer fixes before ordering. */
import type { Design, Issue, Unit } from "./types";

export function validateUnits(design: Design, units: Unit[]): Issue[] {
  const issues: Issue[] = [];
  const seen = new Set<string>();
  for (const unit of units) {
    if (seen.has(unit.recipient_ref)) issues.push({ recipient_ref: unit.recipient_ref, field: "recipient_ref", reason: "Duplicate recipient" });
    seen.add(unit.recipient_ref);
    for (const field of design.fields) {
      const value = (unit.values[field.key] ?? "").trim();
      if (field.required && !value) issues.push({ recipient_ref: unit.recipient_ref, field: field.key, reason: `${field.label} missing` });
      else if (value.length > field.max_length) issues.push({ recipient_ref: unit.recipient_ref, field: field.key, reason: `${field.label} over ${field.max_length} characters` });
      else if (field.kind === "monogram" && value && !/^[A-Za-z]{1,3}$/.test(value)) issues.push({ recipient_ref: unit.recipient_ref, field: field.key, reason: `${field.label} takes one to three letters` });
    }
    for (const key of Object.keys(unit.values)) if (!design.fields.some((f) => f.key === key)) issues.push({ recipient_ref: unit.recipient_ref, field: key, reason: "Not a field of this design" });
  }
  return issues;
}
