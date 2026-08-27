/** Fixtures for the agent tests: a fresh in-memory project with a space, and fake catalog objects. */
import type { Category } from "../domain/types";
import { appState } from "../server/state";
import type { SourcingDeps } from "./sourcing";

export const DEMO_SPACE = { width_mm: 3658, length_mm: 5486 };

export function resetState(): void {
  globalThis.__plannerState = undefined;
}

export function seedProject(options: { address?: boolean; requiredBy?: string } = {}): string {
  const s = appState();
  const id = s.store.newId("proj");
  s.store.insertProject({
    id,
    name: "Test living room",
    budget_cents: 250000,
    currency: "USD",
    required_by: options.requiredBy ?? "2026-09-15",
    delivery_address_json: options.address
      ? { line1: null, city: "New York", region: "NY", postal_code: "10003", country: "US", source: "inferred" }
      : null,
    created_at: new Date().toISOString()
  });
  s.spaces.set("space_1", { id: "space_1", project_id: id, name: "Living room", ...DEMO_SPACE, height_mm: null });
  const requirements: [string, string, unknown][] = [
    ["req_1", "required_item", "sofa"],
    ["req_2", "required_item", "coffee_table"],
    ["req_3", "required_item", "ottoman"],
    ["req_4", "required_item", "rug"],
    ["req_5", "visual_direction", { base_colors: ["warm brown", "neutral"], accent_colors: ["dark blue"] }]
  ];
  for (const [rid, type, value] of requirements) {
    s.requirements.set(rid, { id: rid, project_id: id, scope: "project", type: type as "required_item", value_json: value, status: "agreed", source: "board", created_by: "zach" });
  }
  return id;
}

/** Inch dimensions per category, W x D x H, all fitting the demo room. */
const DIMS: Record<Category, string> = {
  sofa: '84" W x 36" D x 33" H',
  coffee_table: '48" W x 24" D x 18" H',
  ottoman: '24" W x 24" D x 17" H',
  rug: "8' x 10'",
  side_table: '20" W x 20" D x 24" H'
};

export function fakeCatalogProduct(category: Category, index: number, priceCents: number, extra: Record<string, unknown> = {}) {
  const domain = `${category.replace("_", "-")}-shop-${index}.myshopify.com`;
  return {
    id: `gid://shopify/Product/${category}-${index}`,
    title: `${category.replace("_", " ")} ${index}`,
    description: { plain: "Ships in 3 to 5 business days." },
    url: `https://${domain}/products/${category}-${index}`,
    metadata: { tech_specs: DIMS[category] },
    media: [{ url: `https://${domain}/images/${index}.jpg` }],
    variants: [
      {
        id: `gid://shopify/ProductVariant/${category}-${index}`,
        price: { amount: priceCents, currency: "USD" },
        availability: { available: true },
        seller: { domain, name: `Shop ${index}` }
      }
    ],
    ...extra
  };
}

/** Three price points per category: the sum of the middle picks lands in the default window. */
export const FAKE_PRICES: Record<Category, number[]> = {
  sofa: [89900, 119900, 149900],
  coffee_table: [29900, 49900, 69900],
  ottoman: [14900, 24900, 34900],
  rug: [19900, 39900, 59900],
  side_table: [29500]
};

export function fakeSearch(category: Category): unknown[] {
  return FAKE_PRICES[category].map((price, i) => fakeCatalogProduct(category, i + 1, price));
}

export function fakeDeps(overrides: Partial<SourcingDeps> = {}): SourcingDeps & { deliveryCalls: string[] } {
  const deliveryCalls: string[] = [];
  return {
    deliveryCalls,
    search: async (category) => fakeSearch(category),
    evaluateDelivery: async (_projectId, candidateId) => {
      deliveryCalls.push(candidateId);
      const s = appState();
      const c = s.store.candidates.get(candidateId)!;
      s.store.candidates.set(candidateId, { ...c, delivery_status: "likely", delivery_evidence_json: { source: "test" } });
      return { status: "likely" };
    },
    evaluateVisualFit: async (_projectId, candidateId) => {
      const s = appState();
      const c = s.store.candidates.get(candidateId)!;
      const visual = { overall: "pass" as const, checks: [{ requirement: "warm", result: "pass" as const, confidence: 0.9 }] };
      s.store.candidates.set(candidateId, { ...c, visual_evaluation_json: visual });
      return visual;
    },
    sideTablePriceCents: 29500,
    evaluatePerCategory: 6,
    ...overrides
  };
}
