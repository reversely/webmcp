/**
 * Gather's records (PRD Section 7). Everything domain-specific is a row: a question is an
 * AttributeDefinition, an answer an AttributeValue, a role a string the organizer chose. Code
 * knows the eight value types, the filter grammar (filter.ts), and the tool list (webmcp/tools.ts).
 * Money is in cents; dates are ISO strings.
 */
import { z } from "zod";
import { OPS } from "./filter";

export const ValueType = z.enum(["text", "number", "boolean", "enum", "multi_enum", "date", "file", "reference"]);
export type ValueType = z.infer<typeof ValueType>;

export const Option = z.object({ value: z.string(), label: z.string() });
export type Option = z.infer<typeof Option>;

export const Constraints = z.object({
  options: z.array(Option).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  max_length: z.number().int().optional(),
  pattern: z.string().optional()
});
export type Constraints = z.infer<typeof Constraints>;

export const AttributeDefinition = z.object({
  id: z.string(),
  event_id: z.string(),
  namespace: z.enum(["core", "organizer"]),
  key: z.string(),
  label: z.string(),
  scope: z.enum(["guest", "party", "event"]),
  value_type: ValueType,
  constraints: Constraints,
  /** Who may read the value beyond the organizer: vendor token holders listed by id. */
  default_visibility: z.array(z.string()),
  /** When a guest must answer: always, only when going, or never. */
  required_rule: z.enum(["always", "going", "never"]),
  creator: z.string()
});
export type AttributeDefinition = z.infer<typeof AttributeDefinition>;

export const Lock = z.object({ batch_id: z.string(), date: z.string() });
export type Lock = z.infer<typeof Lock>;

export const AttributeValue = z.object({
  subject_type: z.enum(["guest", "party", "event"]),
  subject_id: z.string(),
  definition_id: z.string(),
  value: z.unknown(),
  /** guest, organizer, or the token id of the agent that wrote it. */
  source: z.string(),
  lock: Lock.nullable(),
  updated_at: z.string(),
  seq: z.number().int()
});
export type AttributeValue = z.infer<typeof AttributeValue>;

export const GuestStatus = z.enum(["going", "maybe", "cant_go", "no_reply"]);
export type GuestStatus = z.infer<typeof GuestStatus>;

export const Segment = z.object({ id: z.string(), name: z.string(), capacity: z.number().int().nullable() });
export type Segment = z.infer<typeof Segment>;

export const Venue = z.object({
  name: z.string(),
  line1: z.string(),
  city: z.string(),
  region: z.string(),
  postal_code: z.string(),
  country: z.string()
});
export type Venue = z.infer<typeof Venue>;

export const EventSettings = z.object({
  guest_approval: z.boolean(),
  reminders: z.boolean(),
  reask_on_change: z.boolean(),
  order_approval: z.boolean()
});
export type EventSettings = z.infer<typeof EventSettings>;

export const Event = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  host: z.string(),
  starts_at: z.string(),
  venue: Venue,
  spots: z.number().int().nullable(),
  cost_per_person_cents: z.number().int().nullable(),
  rsvp_deadline: z.string().nullable(),
  description: z.string(),
  invite_extras: z.array(z.string()),
  response_options: z.array(GuestStatus),
  settings: EventSettings,
  segments: z.array(Segment),
  definition_ids: z.array(z.string()),
  status: z.enum(["draft", "published"]),
  invite_code: z.string().nullable(),
  created_at: z.string()
});
export type Event = z.infer<typeof Event>;

export const Party = z.object({
  id: z.string(),
  event_id: z.string(),
  guest_ids: z.array(z.string()),
  contact: z.object({ email: z.string().nullable(), phone: z.string().nullable() }),
  plus_one_allowance: z.number().int()
});
export type Party = z.infer<typeof Party>;

export const Guest = z.object({
  id: z.string(),
  event_id: z.string(),
  party_id: z.string(),
  /** A row the organizer creates: guest, plus-one, child, speaker, or any word. */
  role: z.string(),
  status: GuestStatus,
  attendance: z.record(z.string(), z.boolean()),
  display_name: z.string()
});
export type Guest = z.infer<typeof Guest>;

export const UpdateKind = z.enum(["confirmed", "in_production", "shipped", "delivered", "issue", "question", "proof", "reply"]);
export type UpdateKind = z.infer<typeof UpdateKind>;

export const VendorUpdate = z.object({
  id: z.string(),
  event_id: z.string(),
  gift_id: z.string(),
  caller: z.string(),
  kind: UpdateKind,
  text: z.string(),
  expected_date: z.string().nullable(),
  reference: z.string().nullable(),
  asset: z.string().nullable(),
  /** A guest the update names, for an issue with one unit. */
  guest_id: z.string().nullable(),
  created_at: z.string(),
  seq: z.number().int()
});
export type VendorUpdate = z.infer<typeof VendorUpdate>;

export const CallerToken = z.object({
  id: z.string(),
  event_id: z.string(),
  holder: z.string(),
  gift_ids: z.array(z.string()),
  readable_definition_ids: z.array(z.string()),
  callable_tools: z.array(z.string()),
  expires_at: z.string().nullable(),
  last_profile_url: z.string().nullable()
});
export type CallerToken = z.infer<typeof CallerToken>;

/** One entry of the change log: a value write, a status change, or a vendor update. */
export const ChangeEntry = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("value"), seq: z.number().int(), at: z.string(), event_id: z.string(), subject_type: z.enum(["guest", "party", "event"]), subject_id: z.string(), definition_id: z.string(), value: z.unknown(), source: z.string() }),
  z.object({ kind: z.literal("status"), seq: z.number().int(), at: z.string(), event_id: z.string(), guest_id: z.string(), from: GuestStatus, to: GuestStatus, source: z.string() }),
  z.object({ kind: z.literal("update"), seq: z.number().int(), at: z.string(), event_id: z.string(), update_id: z.string(), gift_id: z.string(), update_kind: UpdateKind, caller: z.string() })
]);
export type ChangeEntry = z.infer<typeof ChangeEntry>;

/* ---- Gifts ---- */

/** One clause of the filter grammar (filter.ts) as a schema, so a stored rule validates on write. */
export const FilterClauseSchema = z.object({ field: z.string(), op: z.enum(OPS), value: z.unknown().optional() });
export const FilterSchema = z.array(FilterClauseSchema);

export const Variant = z.object({ id: z.string(), title: z.string(), price_cents: z.number().int(), currency: z.string() });
export type Variant = z.infer<typeof Variant>;

/** One value of one definition sends the guest to one variant; the organizer's rows are the source of truth. */
export const VariantMappingRow = z.object({ definition_id: z.string(), value: z.string(), variant_id: z.string() });
export type VariantMappingRow = z.infer<typeof VariantMappingRow>;

export const MissingValueFallback = z.enum(["default", "blank", "hold"]);
export type MissingValueFallback = z.infer<typeof MissingValueFallback>;

export const PostLockCancellation = z.enum(["keep", "reassign", "drop"]);
export type PostLockCancellation = z.infer<typeof PostLockCancellation>;

export const UnitStatus = z.enum(["open", "locked", "unservable", "held", "cancelled_reassignable", "cancelled_sunk", "excluded"]);
export type UnitStatus = z.infer<typeof UnitStatus>;

/** A plan rule: the first rule whose filter matches a guest assigns the product. */
export const GiftRule = z.object({ filter: FilterSchema, product_id: z.string() });
export type GiftRule = z.infer<typeof GiftRule>;

/** The organizer's per-guest decision; it wins over the computed variant and survives every recompute. */
export const GiftOverride = z.object({ variant_id: z.string().optional(), excluded: z.boolean().optional() });
export type GiftOverride = z.infer<typeof GiftOverride>;

export const Batch = z.object({
  id: z.string(),
  event_id: z.string(),
  product_id: z.string(),
  shop_domain: z.string(),
  product_title: z.string(),
  recipients: FilterSchema,
  mapping: z.array(VariantMappingRow),
  default_variant_id: z.string().nullable(),
  variants: z.array(Variant),
  missing_value_fallback: MissingValueFallback,
  post_lock_cancellation: PostLockCancellation,
  cutoff: z.string().nullable(),
  cart_id: z.string().nullable(),
  checkout_id: z.string().nullable(),
  order_id: z.string().nullable(),
  rules: z.array(GiftRule),
  overrides: z.record(z.string(), GiftOverride),
  /** Set by the lock: the date and the guests whose units the checkout carries. */
  locked_at: z.string().nullable(),
  locked_guest_ids: z.array(z.string())
});
export type Batch = z.infer<typeof Batch>;

/** A synonym row proposes a mapping when a variant title matches the pattern for an option label; the table ships empty. */
export const SynonymRow = z.object({ option_label_pattern: z.string(), variant_title_pattern: z.string() });
export type SynonymRow = z.infer<typeof SynonymRow>;
