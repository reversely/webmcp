/**
 * Per-tool summaries of the project snapshot an API route returns.
 *
 * Every route in docs/prd.md section 19 answers with the updated project snapshot. The model does
 * not need the whole snapshot after each call, so each tool keeps only the fields that inform the
 * model's next step:
 *
 * - Ids the model must quote back (BOM line ids, product ids) stay; database ids it never quotes
 *   (candidate ids, placement ids, member ids) go.
 * - Money stays in cents and lengths in millimetres, unchanged, so numbers round-trip exactly.
 * - Merchant text (product descriptions, availability blobs, evidence payloads) is dropped; only
 *   the product title identifies a line, and it is the one merchant-supplied string that remains.
 * - BOM lines with status `removed` are hidden from the state read but kept, with their status, in
 *   the write summaries so the model can see the effect of a `remove` and restore it with `add`.
 * - `superseded` requirements never appear.
 *
 * The snapshot shape is the loose superset below; every field is optional so a summary degrades to
 * fewer fields rather than throwing when the server omits one.
 */
import type { BomItem, Placement, Product, Project, Requirement, Space } from "@/domain/types";
import type { ToolName } from "./tools";

type Loose<T> = { [K in keyof T]?: T[K] | null };

export interface BomLineSnapshot extends Loose<BomItem> {
  product?: Loose<Product> | null;
  delivery_status?: string | null;
}

export interface GeometryConflict {
  bom_item_ids?: string[];
  kind?: string;
  detail?: string;
}

export interface ProjectSnapshot {
  project?: Loose<Project>;
  space?: Loose<Space>;
  requirements?: Loose<Requirement>[];
  bom?: BomLineSnapshot[];
  products?: Loose<Product>[];
  placements?: Loose<Placement>[];
  budget?: { committed_cents?: number; state?: string };
  evaluation?: {
    missing_categories?: string[];
    geometry_conflicts?: GeometryConflict[];
    unresolved_issues?: string[];
  };
  unresolved_questions?: string[];
}

interface BomLineSummary {
  id: string | null;
  category: string | null;
  product_id: string | null;
  title: string | null;
  price_cents: number | null;
  quantity: number | null;
  status: string | null;
  delivery_status?: string | null;
}

function budgetSummary(snapshot: ProjectSnapshot) {
  return {
    limit_cents: snapshot.project?.budget_cents ?? null,
    currency: snapshot.project?.currency ?? null,
    committed_cents: snapshot.budget?.committed_cents ?? null,
    state: snapshot.budget?.state ?? null
  };
}

function roomSummary(snapshot: ProjectSnapshot) {
  const space = snapshot.space;
  if (!space) return null;
  return {
    name: space.name ?? null,
    width_mm: space.width_mm ?? null,
    length_mm: space.length_mm ?? null,
    height_mm: space.height_mm ?? null
  };
}

function deliverySummary(snapshot: ProjectSnapshot) {
  const address = snapshot.project?.delivery_address_json;
  return {
    required_by: snapshot.project?.required_by ?? null,
    destination: address ? { postal_code: address.postal_code, country: address.country } : null
  };
}

function requirementsSummary(snapshot: ProjectSnapshot) {
  return (snapshot.requirements ?? [])
    .filter((requirement) => requirement.status !== "superseded")
    .map((requirement) => ({
      type: requirement.type ?? null,
      value: requirement.value_json ?? null,
      scope: requirement.scope ?? null,
      status: requirement.status ?? null
    }));
}

function bomSummary(snapshot: ProjectSnapshot, { includeRemoved }: { includeRemoved: boolean }): BomLineSummary[] {
  // Lines may embed their product or refer to one in `products`; index once so each line is O(1).
  const productsById = new Map((snapshot.products ?? []).map((product) => [product.id, product]));
  return (snapshot.bom ?? [])
    .filter((line) => includeRemoved || line.status !== "removed")
    .map((line) => {
      const product = line.product ?? (line.product_id ? productsById.get(line.product_id) : undefined);
      return {
        id: line.id ?? null,
        category: line.category ?? null,
        product_id: line.product_id ?? product?.id ?? null,
        title: product?.title ?? null,
        price_cents: product?.price_cents ?? null,
        quantity: line.quantity ?? null,
        status: line.status ?? null,
        ...(line.delivery_status !== undefined ? { delivery_status: line.delivery_status } : {})
      };
    });
}

function placementsSummary(snapshot: ProjectSnapshot) {
  return (snapshot.placements ?? []).map((placement) => ({
    bom_item_id: placement.bom_item_id ?? null,
    x_mm: placement.x_mm ?? null,
    y_mm: placement.y_mm ?? null,
    rotation_deg: placement.rotation_deg ?? null
  }));
}

function writeSummary(snapshot: ProjectSnapshot) {
  return { budget: budgetSummary(snapshot), bom: bomSummary(snapshot, { includeRemoved: true }) };
}

const SUMMARIZERS: Record<ToolName, (snapshot: ProjectSnapshot) => unknown> = {
  get_project_state: (snapshot) => ({
    project_id: snapshot.project?.id ?? null,
    name: snapshot.project?.name ?? null,
    room: roomSummary(snapshot),
    requirements: requirementsSummary(snapshot),
    budget: budgetSummary(snapshot),
    bom: bomSummary(snapshot, { includeRemoved: false }),
    delivery: deliverySummary(snapshot),
    unresolved_questions: snapshot.unresolved_questions ?? []
  }),
  add_product: writeSummary,
  set_project_requirement: (snapshot) => ({
    ...writeSummary(snapshot),
    room: roomSummary(snapshot),
    requirements: requirementsSummary(snapshot),
    delivery: deliverySummary(snapshot)
  }),
  update_bom: writeSummary,
  replace_bom_item: writeSummary,
  place_product: (snapshot) => ({
    placements: placementsSummary(snapshot),
    geometry_conflicts: snapshot.evaluation?.geometry_conflicts ?? []
  }),
  evaluate_project: (snapshot) => ({
    budget: budgetSummary(snapshot),
    missing_categories: snapshot.evaluation?.missing_categories ?? [],
    geometry_conflicts: snapshot.evaluation?.geometry_conflicts ?? [],
    delivery: {
      required_by: snapshot.project?.required_by ?? null,
      lines: bomSummary(snapshot, { includeRemoved: false }).map(({ id, title, delivery_status }) => ({
        bom_item_id: id,
        title,
        status: delivery_status ?? null
      }))
    },
    unresolved_issues: snapshot.evaluation?.unresolved_issues ?? []
  })
};

/** Reduces a route's JSON response to the fields the model needs after calling `toolName`. */
export function summarize(toolName: ToolName, responseJson: unknown): unknown {
  const snapshot = (responseJson && typeof responseJson === "object" ? responseJson : {}) as ProjectSnapshot;
  return SUMMARIZERS[toolName](snapshot);
}
