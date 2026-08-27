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

export const Category = z.enum(["sofa", "coffee_table", "ottoman", "rug", "side_table"]);
export type Category = z.infer<typeof Category>;

export const DeliveryAddress = z.object({
  line1: z.string().nullable(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  postal_code: z.string(),
  country: z.string(),
  source: z.enum(["given", "inferred"])
});
export type DeliveryAddress = z.infer<typeof DeliveryAddress>;

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
