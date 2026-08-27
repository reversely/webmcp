/**
 * Domain entities for the living-room planner, mirroring docs/prd.md section 12.
 *
 * Conventions (PRD section 2 and 12.1):
 * - Every length is an integer number of millimetres.
 * - Money is an integer number of minor currency units (cents).
 * - Floor-plane coordinates: `x` runs along the room width, `y` along the room length, both from
 *   the origin corner (bottom-left in the top-down view). `z` points up.
 * - A product's `width_mm` runs across its front, `depth_mm` front to back, `height_mm` up. After
 *   orientation normalization its front faces +y in its local frame; `rotation_deg` rotates it
 *   counter-clockwise about z.
 */
import { z } from "zod";

export const Millimetres = z.number().int().nonnegative();
export const Cents = z.number().int().nonnegative();

export const RequirementStatus = z.enum(["draft", "agreed", "superseded"]);
export const SpatialStatus = z.enum(["grounded", "visual_only"]);
export const ModelStatus = z.enum(["no_model", "queued", "generating", "ready", "proxy", "failed"]);
export const BomItemStatus = z.enum(["proposed", "approved", "removed"]);
export const DeliveryStatus = z.enum(["confirmed", "likely", "unknown", "fail"]);
export const AgentRunStatus = z.enum(["running", "waiting_for_user", "complete", "failed_recoverable"]);
export const BudgetState = z.enum(["under", "exact", "over"]);

/**
 * An item's own phrase from the board ("reading chair", "big rug"). The application carries no
 * vocabulary of item names; the phrase is the key that sourcing, ranking, the BOM, and the layout
 * rules share (PRD 16, 20).
 */
export const Category = z.string().min(1);
export type Category = z.infer<typeof Category>;

/** The rendering kind of an item, inferred by the PlanningAgent from its name and editable by a person (PRD 20). */
export const Kind = z.enum(["seating", "table", "storage", "soft_floor", "bed", "lighting", "decor", "other"]);
export type Kind = z.infer<typeof Kind>;
export const KINDS = Kind.options;

/** A `required_item` requirement value: the item's name in the users' words plus its kind once inferred. */
export const RequiredItem = z.object({ name: z.string().min(1), kind: Kind.nullable() });
export type RequiredItem = z.infer<typeof RequiredItem>;

/** Reads a `required_item` value, accepting the bare string older rows and the board form write. */
export function readRequiredItem(value: unknown): RequiredItem | null {
  if (typeof value === "string") return value.trim() ? { name: value.trim(), kind: null } : null;
  const parsed = RequiredItem.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const Relation = z.enum(["under", "on_top_of", "beside", "facing", "against_wall", "clear_around"]);
export type Relation = z.infer<typeof Relation>;

/**
 * A `layout_requirement` value (PRD 14, 16): a relation between named items, or a sentence the
 * board stated that no relation matched, kept as text and never evaluated.
 */
export const LayoutRule = z.union([
  z.object({ relation: Relation, subject: z.string().min(1), objects: z.array(z.string()), distance_mm: Millimetres.optional() }),
  z.object({ relation: z.literal("text"), text: z.string() })
]);
export type LayoutRule = z.infer<typeof LayoutRule>;

/** Reads a `layout_requirement` value; a bare string is a text rule. */
export function readLayoutRule(value: unknown): LayoutRule | null {
  if (typeof value === "string") return { relation: "text", text: value };
  const parsed = LayoutRule.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Comparison key for item names: case and surrounding whitespace never distinguish two items. */
export function itemKey(name: string): string {
  return name.trim().toLowerCase();
}

export const ADDRESS_FIELDS = ["line1", "city", "region", "postal_code", "country"] as const;
export type AddressField = (typeof ADDRESS_FIELDS)[number];

/**
 * The project's delivery address. `country` is null and `postal_code` empty when the reply could
 * not be read as an address and was kept as `line1` verbatim; a search then carries no
 * destination. `source` is `given` when the person stated the address (a street line or a city),
 * `inferred` when a postal code alone supplied it; `inferred_fields` lists the fields filled in
 * around what the text said.
 */
export const DeliveryAddress = z.object({
  line1: z.string().nullable(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  postal_code: z.string(),
  country: z.string().nullable(),
  /** ISO 4217 code for the country, when known; the catalog's buyer context carries it. */
  currency: z.string().nullable().optional(),
  source: z.enum(["given", "inferred"]),
  inferred_fields: z.array(z.enum(ADDRESS_FIELDS)).optional()
});
export type DeliveryAddress = z.infer<typeof DeliveryAddress>;

/** What the model reads out of a free-text reply; a non-address comes back with `is_address` false. */
export const ExtractedAddress = z.object({
  is_address: z.boolean().describe("True when the text is, or contains, a delivery address or postal code; false for any other message."),
  line1: z.string().nullable().describe("The street line as written, or null when the text has none."),
  city: z.string().nullable().describe("The city or locality, stated or implied by the postal code."),
  region: z.string().nullable().describe("The state, province, or region in the country's usual short form (NY, ON, England), stated or implied by the postal code."),
  postal_code: z.string().nullable().describe("The postal code in the country's canonical form, keeping any internal space (M6A 0G9, SW1A 1AA, 10003)."),
  country: z.string().nullable().describe("ISO 3166-1 alpha-2 code of the country the address is in, read from the postal code format and place names."),
  currency: z.string().nullable().describe("ISO 4217 code of that country's currency."),
  stated_fields: z.array(z.enum(ADDRESS_FIELDS)).describe("The fields the text itself states; every other non-null field was filled in."),
  confidence: z.number().describe("From 0 to 1: how sure the reading of country and postal code is.")
});
export type ExtractedAddress = z.infer<typeof ExtractedAddress>;

export const Project = z.object({
  id: z.string(),
  name: z.string(),
  budget_cents: Cents,
  currency: z.string().length(3),
  required_by: z.string().date().nullable(),
  delivery_address_json: DeliveryAddress.nullable(),
  created_at: z.string().datetime()
});
export type Project = z.infer<typeof Project>;

export const Member = z.object({
  id: z.string(),
  project_id: z.string(),
  user_id: z.string(),
  display_name: z.string()
});
export type Member = z.infer<typeof Member>;

export const Space = z.object({
  id: z.string(),
  project_id: z.string(),
  name: z.string(),
  width_mm: Millimetres,
  length_mm: Millimetres,
  height_mm: Millimetres.nullable()
});
export type Space = z.infer<typeof Space>;

export const Requirement = z.object({
  id: z.string(),
  project_id: z.string(),
  scope: z.string(),
  type: z.enum(["required_item", "visual_direction", "layout_requirement"]),
  value_json: z.unknown(),
  status: RequirementStatus,
  source: z.string(),
  created_by: z.string()
});
export type Requirement = z.infer<typeof Requirement>;

export const DimensionSource = z.object({
  text: z.string(),
  url: z.string().url(),
  unit: z.enum(["in", "ft", "cm", "mm"])
});

export const Product = z.object({
  id: z.string(),
  merchant: z.string(),
  source_url: z.string().url(),
  external_product_id: z.string(),
  title: z.string(),
  description: z.string(),
  primary_image_url: z.string().url().nullable(),
  price_cents: Cents,
  currency: z.string().length(3),
  width_mm: Millimetres.nullable(),
  depth_mm: Millimetres.nullable(),
  height_mm: Millimetres.nullable(),
  dimension_source: DimensionSource.nullable(),
  spatial_status: SpatialStatus,
  variant_json: z.unknown().nullable(),
  availability_json: z.unknown().nullable(),
  glb_url: z.string().url().nullable(),
  model_status: ModelStatus
});
export type Product = z.infer<typeof Product>;

export const Candidate = z.object({
  id: z.string(),
  project_id: z.string(),
  product_id: z.string(),
  category: Category,
  kind: Kind,
  hard_constraint_results_json: z.unknown().nullable(),
  visual_evaluation_json: z.unknown().nullable(),
  delivery_status: DeliveryStatus.nullable(),
  delivery_evidence_json: z.unknown().nullable(),
  ranking_state: z.enum(["pending", "eliminated", "ranked", "selected"]),
  rank: z.number().int().nullable()
});
export type Candidate = z.infer<typeof Candidate>;

export const BomItem = z.object({
  id: z.string(),
  project_id: z.string(),
  product_id: z.string(),
  category: Category,
  kind: Kind,
  quantity: z.number().int().positive(),
  status: BomItemStatus
});
export type BomItem = z.infer<typeof BomItem>;

export const Placement = z.object({
  id: z.string(),
  space_id: z.string(),
  bom_item_id: z.string(),
  x_mm: z.number().int(),
  y_mm: z.number().int(),
  z_mm: z.number().int(),
  rotation_deg: z.number()
});
export type Placement = z.infer<typeof Placement>;

export const Decision = z.object({
  id: z.string(),
  project_id: z.string(),
  actor: z.string(),
  type: z.string(),
  payload_json: z.unknown(),
  created_at: z.string().datetime()
});
export type Decision = z.infer<typeof Decision>;

export const AgentRun = z.object({
  id: z.string(),
  project_id: z.string(),
  goal: z.string(),
  status: AgentRunStatus,
  missing_fields_json: z.array(z.string()),
  pending_operation_json: z.unknown().nullable(),
  started_at: z.string().datetime(),
  completed_at: z.string().datetime().nullable()
});
export type AgentRun = z.infer<typeof AgentRun>;

/** A product's box on the floor plane plus its height, used by geometry and 3D scaling. */
export const Box = z.object({
  width_mm: Millimetres,
  depth_mm: Millimetres,
  height_mm: Millimetres
});
export type Box = z.infer<typeof Box>;

export const MM_PER_INCH = 25.4;
export const MM_PER_FOOT = 304.8;

export function feetToMm(feet: number): number {
  return Math.round(feet * MM_PER_FOOT);
}

export function inchesToMm(inches: number): number {
  return Math.round(inches * MM_PER_INCH);
}

/** Formats millimetres as feet and inches for display, e.g. 3658 → `12' 0"`. */
export function formatFeetInches(mm: number): string {
  const totalInches = mm / MM_PER_INCH;
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches - feet * 12);
  if (inches === 12) return `${feet + 1}' 0"`;
  return `${feet}' ${inches}"`;
}
