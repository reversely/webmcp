import type { Candidate, Category, Placement, Product } from "../types";
import type { DomainEvent } from "./events";
import { ProjectStore } from "./store";

export const PROJECT_ID = "p1";
export const SPACE_ID = "s1";

/** Demo prices: the four sourced items land in [250000 − P_side, 250000); the side table tips over. */
export const PRICES = {
  sofa: 129500,
  coffee_table: 45000,
  ottoman: 30000,
  rug: 40000,
  side_table: 15000,
  cheaper_table: 32000
} as const;

export function product(id: string, price_cents: number): Product {
  return {
    id,
    merchant: "floydhome.com",
    source_url: `https://floydhome.com/products/${id}`,
    external_product_id: `gid://shopify/Product/${id}`,
    title: id,
    description: "",
    primary_image_url: null,
    price_cents,
    currency: "USD",
    width_mm: 1000,
    depth_mm: 500,
    height_mm: 400,
    dimension_source: null,
    spatial_status: "grounded",
    variant_json: null,
    availability_json: null,
    glb_url: null,
    model_status: "no_model"
  };
}

export function candidate(
  id: string,
  productId: string,
  category: Category,
  ranking_state: Candidate["ranking_state"] = "selected"
): Candidate {
  return {
    id,
    project_id: PROJECT_ID,
    product_id: productId,
    category,
    hard_constraint_results_json: null,
    visual_evaluation_json: null,
    delivery_status: null,
    delivery_evidence_json: null,
    ranking_state,
    rank: null
  };
}

export function placement(id: string, bomItemId: string): Placement {
  return { id, space_id: SPACE_ID, bom_item_id: bomItemId, x_mm: 1000, y_mm: 2000, z_mm: 0, rotation_deg: 0 };
}

/** A store with the $2,500 demo project and selected candidates for the four sourced categories. */
export function demoStore(budget_cents = 250000) {
  const events: DomainEvent[] = [];
  const store = new ProjectStore({ emit: (event) => events.push(event) });
  store.insertProject({
    id: PROJECT_ID,
    name: "Zach + Ben Living Room",
    budget_cents,
    currency: "USD",
    required_by: "2026-09-15",
    delivery_address_json: null,
    created_at: "2026-08-27T00:00:00.000Z"
  });
  for (const category of ["sofa", "coffee_table", "ottoman", "rug"] as const) {
    store.products.set(category, product(category, PRICES[category]));
    store.candidates.set(`c_${category}`, candidate(`c_${category}`, category, category));
  }
  store.products.set("side_table", product("side_table", PRICES.side_table));
  store.products.set("cheaper_table", product("cheaper_table", PRICES.cheaper_table));
  return { store, events };
}

export function itemFor(store: ProjectStore, productId: string) {
  const item = [...store.bomItems.values()].find((row) => row.product_id === productId);
  if (!item) throw new Error(`no item for ${productId}`);
  return item;
}

export function rows(store: ProjectStore) {
  return {
    bomItems: [...store.bomItems.values()],
    candidates: [...store.candidates.values()],
    placements: [...store.placements.values()],
    decisions: [...store.decisions.values()],
    project: store.getProject(PROJECT_ID)
  };
}
