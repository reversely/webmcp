/**
 * Personalization mappings (#117): how RSVP definitions, event fields, and literals flow into a
 * vendor's personalization fields. The compatibility tables are data, so a new kind or transform
 * is a row here; gifts.ts calls personalizeRow per manifest row and api.ts calls validateMappings
 * before a mapping is stored.
 */
import type { Subject } from "./filter";
import type { AttributeDefinition, Batch, Event, MappingSource, PersonalizationField, PersonalizationKind, PersonalizationMapping, PersonalizationTransform, ValueType, Venue } from "./types";

export type PersonalizationIssue = { guest_id?: string; vendor_field_key: string; code: "missing_source" | "missing_value" | "invalid_type" | "too_long" | "unsupported_value"; message: string };
export type PersonalizationStatus = "ready" | "incomplete" | "invalid";
export type ResolvedField = { value: unknown; source: MappingSource };
export type RowPersonalization = { personalization: Record<string, ResolvedField>; personalization_status: PersonalizationStatus; personalization_issues: PersonalizationIssue[] };

type EventKey = "title" | "starts_at" | "venue";

/** The definition value types each field kind accepts. */
export const KIND_VALUE_TYPES: Record<PersonalizationKind, ValueType[]> = {
  text: ["text", "enum", "number"],
  name: ["text"],
  monogram: ["text"],
  date: ["date"],
  location: ["text"],
  star_map: ["text", "date"],
  color: ["text", "enum"],
  word_list: ["text", "multi_enum"]
};

/** The event keys each field kind accepts without a transform. */
export const KIND_EVENT_KEYS: Record<PersonalizationKind, EventKey[]> = {
  text: ["title", "starts_at"],
  name: ["title"],
  monogram: [],
  date: ["starts_at"],
  location: ["venue"],
  star_map: ["starts_at", "venue"],
  color: [],
  word_list: []
};

/** The definition value types each transform accepts. */
export const TRANSFORM_VALUE_TYPES: Record<PersonalizationTransform, ValueType[]> = { uppercase: ["text", "enum"], lowercase: ["text", "enum"], date_only: ["date"], location_query: [] };

/** The event keys each transform accepts. */
export const TRANSFORM_EVENT_KEYS: Record<PersonalizationTransform, EventKey[]> = { uppercase: ["title"], lowercase: ["title"], date_only: ["starts_at"], location_query: ["venue"] };

/* ---- Validation (set_personalization_mapping) ---- */

export type MappingError = { vendor_field_key: string; code: "unknown_field" | "unmapped_required" | "unknown_definition" | "scope_mismatch" | "incompatible_type" | "incompatible_transform"; message: string };

/** Every reason a mapping list cannot be stored against the gift's product schema and the event's definitions. */
export function validateMappings(gift: Batch, event: Event, mappings: PersonalizationMapping[], definitions: AttributeDefinition[]): MappingError[] {
  const errors: MappingError[] = [];
  const fields = new Map((gift.personalization?.fields ?? []).map((f) => [f.key, f]));
  const defs = new Map(definitions.map((d) => [d.id, d]));
  for (const mapping of mappings) {
    const field = fields.get(mapping.vendor_field_key);
    if (!field) {
      errors.push({ vendor_field_key: mapping.vendor_field_key, code: "unknown_field", message: `the product has no field ${mapping.vendor_field_key}` });
      continue;
    }
    errors.push(...sourceErrors(mapping, field, defs));
  }
  for (const field of gift.personalization?.fields ?? []) {
    if (field.required && !mappings.some((m) => m.vendor_field_key === field.key)) errors.push({ vendor_field_key: field.key, code: "unmapped_required", message: `${field.label} needs a mapping` });
  }
  return errors;
}

function sourceErrors(mapping: PersonalizationMapping, field: PersonalizationField, defs: Map<string, AttributeDefinition>): MappingError[] {
  const errors: MappingError[] = [];
  const err = (code: MappingError["code"], message: string) => errors.push({ vendor_field_key: mapping.vendor_field_key, code, message });
  const { source, transform } = mapping;
  if (source.type === "definition") {
    const def = defs.get(source.definition_id);
    if (!def) {
      err("unknown_definition", `no definition ${source.definition_id} on this event`);
      return errors;
    }
    if (def.scope !== source.subject_scope) err("scope_mismatch", `${def.label} is ${def.scope} scoped`);
    if (!KIND_VALUE_TYPES[field.kind].includes(def.value_type)) err("incompatible_type", `${def.label} does not fit a ${field.kind} field`);
    if (transform && !TRANSFORM_VALUE_TYPES[transform].includes(def.value_type)) err("incompatible_transform", `${transform} does not fit ${def.label}`);
  } else if (source.type === "event") {
    // A valid transform reshapes the event value into the field's kind, so the untransformed table applies only without one.
    if (transform) {
      if (!TRANSFORM_EVENT_KEYS[transform].includes(source.key)) err("incompatible_transform", `${transform} does not fit the event ${source.key}`);
    } else if (!KIND_EVENT_KEYS[field.kind].includes(source.key)) err("incompatible_type", `the event ${source.key} does not fit a ${field.kind} field`);
  } else if (transform) {
    // Apply the transform to the literal exactly as personalizeRow will later, so a literal the
    // transform can never consume (a "hello" into date_only) is refused here, not per unit downstream.
    const applied = applyTransform(transform, source.value);
    if (!applied.ok) err("incompatible_transform", applied.reason);
  }
  return errors;
}

/* ---- Resolution (get_manifest) ---- */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;
const isMissing = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** True when the gift's product carries personalization fields, so its manifest rows resolve values. */
export function personalized(gift: Batch): boolean {
  return (gift.personalization?.fields.length ?? 0) > 0;
}

/** The venue as one search string for a location autocomplete: name, city, region, country. */
export function locationQuery(venue: Partial<Venue>): string {
  return [venue.name, venue.city, venue.region, venue.country].filter((part) => typeof part === "string" && part.trim() !== "").join(", ");
}

/** The raw value a mapping's source names: the subject's answer, the event field, or the literal. */
export function resolveSourceValue(source: MappingSource, event: Event, subject: Subject): unknown {
  switch (source.type) {
    case "definition":
      return subject.values[source.definition_id];
    case "event":
      return source.key === "title" ? event.title : source.key === "starts_at" ? event.starts_at : event.venue;
    case "literal":
      return source.value;
  }
}

/** Applies one transform; a missing value passes through so the missing-value issue names the real cause. */
export function applyTransform(transform: PersonalizationTransform, value: unknown): { ok: true; value: unknown } | { ok: false; reason: string } {
  if (isMissing(value)) return { ok: true, value };
  switch (transform) {
    case "uppercase":
    case "lowercase":
      if (typeof value !== "string") return { ok: false, reason: `${transform} needs text` };
      return { ok: true, value: transform === "uppercase" ? value.toUpperCase() : value.toLowerCase() };
    case "date_only":
      if (typeof value !== "string" || !ISO_DATE.test(value) || Number.isNaN(Date.parse(value))) return { ok: false, reason: "date_only needs an ISO date" };
      return { ok: true, value: value.slice(0, 10) };
    case "location_query": {
      if (typeof value !== "object" || value === null) return { ok: false, reason: "location_query needs an address" };
      const query = locationQuery(value as Partial<Venue>);
      if (!query) return { ok: false, reason: "the address has no usable part" };
      return { ok: true, value: query };
    }
  }
}

function valueIssue(field: PersonalizationField, value: unknown): Pick<PersonalizationIssue, "code" | "message"> | null {
  if (field.kind === "date") {
    if (typeof value !== "string" || !ISO_DATE.test(value) || Number.isNaN(Date.parse(value))) return { code: "invalid_type", message: `${field.label} needs a date` };
  } else if (field.kind === "word_list") {
    const list = Array.isArray(value) ? value : typeof value === "string" ? [value] : null;
    if (!list || list.some((v) => typeof v !== "string")) return { code: "invalid_type", message: `${field.label} needs words` };
  } else if (typeof value !== "string") {
    return { code: "invalid_type", message: `${field.label} needs text` };
  }
  if (field.max_length !== undefined && typeof value === "string" && value.length > field.max_length) return { code: "too_long", message: `${field.label} allows ${field.max_length} characters` };
  if (field.allowed_values?.length) {
    const values = Array.isArray(value) ? value : [value];
    if (values.some((v) => !field.allowed_values!.includes(String(v)))) return { code: "unsupported_value", message: `${field.label} takes ${field.allowed_values.join(" or ")}` };
  }
  return null;
}

/** Resolves every mapped vendor field for one guest and grades the row: ready, incomplete (a source or value missing), or invalid (a value that fails its field). */
export function personalizeRow(gift: Batch, event: Event, subject: Subject): RowPersonalization {
  const mappings = new Map((gift.personalization_mappings ?? []).map((m) => [m.vendor_field_key, m]));
  const issues: PersonalizationIssue[] = [];
  const resolved: Record<string, ResolvedField> = {};
  const guestId = subject.guest.id;
  for (const field of gift.personalization?.fields ?? []) {
    const mapping = mappings.get(field.key);
    if (!mapping) {
      if (field.required) issues.push({ guest_id: guestId, vendor_field_key: field.key, code: "missing_source", message: `${field.label} has no source` });
      continue;
    }
    let value = resolveSourceValue(mapping.source, event, subject);
    if (mapping.transform) {
      const transformed = applyTransform(mapping.transform, value);
      if (!transformed.ok) {
        issues.push({ guest_id: guestId, vendor_field_key: field.key, code: "invalid_type", message: transformed.reason });
        resolved[field.key] = { value: null, source: mapping.source };
        continue;
      }
      value = transformed.value;
    }
    if (isMissing(value)) {
      if (field.required) issues.push({ guest_id: guestId, vendor_field_key: field.key, code: "missing_value", message: `${field.label} has no value` });
      resolved[field.key] = { value: null, source: mapping.source };
      continue;
    }
    const issue = valueIssue(field, value);
    if (issue) issues.push({ guest_id: guestId, vendor_field_key: field.key, ...issue });
    resolved[field.key] = { value, source: mapping.source };
  }
  const invalid = issues.some((i) => i.code === "invalid_type" || i.code === "too_long" || i.code === "unsupported_value");
  return { personalization: resolved, personalization_status: invalid ? "invalid" : issues.length ? "incomplete" : "ready", personalization_issues: issues };
}
