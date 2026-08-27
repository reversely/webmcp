/** Fixtures for the agent tests: a fresh in-memory project with a space, and fake catalog objects. */
import type { Kind } from "../domain/types";
import { appState } from "../server/state";
import { upsertCandidate } from "./catalog";
import { setKind } from "./kinds";
import type { SourcingDeps } from "./sourcing";

export const DEMO_SPACE = { width_mm: 3658, length_mm: 5486 };

/** The board's own phrases for the test project, with the kind the agent would infer for each. */
export const ITEMS: { name: string; kind: Kind; query: string }[] = [
  { name: "deep couch", kind: "seating", query: "three seat sofa" },
  { name: "round coffee table", kind: "table", query: "round coffee table" },
  { name: "leather ottoman", kind: "decor", query: "leather ottoman" },
  { name: "big rug", kind: "soft_floor", query: "area rug 8x10" }
];
export const ITEM_NAMES = ITEMS.map((i) => i.name);
/** An item the project learns about later: a pasted end table (PRD 8.4's P_side). */
export const EXTRA = { name: "end table", kind: "table" as Kind, query: "end table" };
export const UNDER_RULE = { relation: "under" as const, subject: "big rug", objects: ["deep couch", "round coffee table"] };

export function resetState(): void {
  globalThis.__plannerState = undefined;
}

/** Seeds the kind cache the way inferKind would, so tests never call the model. */
export function seedKinds(): void {
  for (const item of [...ITEMS, EXTRA]) setKind(item.name, { kind: item.kind, query: item.query });
}

/**
 * A fresh project with a space, the four required items in the board's words, and the under rule.
 * `extraPrice` adds a candidate for the end table at that price so sourcing derives its PRD 8.4
 * window; without it there is no window.
 */
export function seedProject(options: { address?: boolean; requiredBy?: string; extraPrice?: number; rules?: boolean } = {}): string {
  const s = appState();
  seedKinds();
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
  s.spaces.set(`space_${id}`, { id: `space_${id}`, project_id: id, name: "Living room", ...DEMO_SPACE, height_mm: null });
  const requirements: [string, unknown][] = [
    ...ITEM_NAMES.map((name): [string, unknown] => ["required_item", name]),
    ["visual_direction", { base: ["#7a5c3e", "#d9c8b0"], accent: ["#1f2f4f"] }],
    ...(options.rules === false ? [] : [["layout_requirement", UNDER_RULE] as [string, unknown]])
  ];
  requirements.forEach(([type, value], i) => {
    const rid = `req_${id}_${i + 1}`;
    s.requirements.set(rid, { id: rid, project_id: id, scope: "project", type: type as "required_item", value_json: value, status: "agreed", source: "board", created_by: "zach" });
  });
  if (options.extraPrice) upsertCandidate(id, fakeCatalogProduct(EXTRA.name, 1, options.extraPrice), EXTRA.name, EXTRA.kind);
  return id;
}

/** Inch dimensions per kind, W x D x H, all fitting the demo room. */
const DIMS: Record<Kind, string> = {
  seating: '84" W x 36" D x 33" H',
  table: '48" W x 24" D x 18" H',
  storage: '40" W x 16" D x 36" H',
  soft_floor: "8' x 10'",
  bed: '60" W x 80" D x 24" H',
  lighting: '12" W x 12" D x 60" H',
  decor: '24" W x 24" D x 17" H',
  other: '20" W x 20" D x 24" H'
};

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export function fakeCatalogProduct(name: string, index: number, priceCents: number, extra: Record<string, unknown> = {}) {
  const kind = [...ITEMS, EXTRA].find((i) => i.name === name)?.kind ?? "other";
  const domain = `${slug(name)}-shop-${index}.myshopify.com`;
  return {
    id: `gid://shopify/Product/${slug(name)}-${index}`,
    title: `${name} ${index}`,
    description: { plain: "Ships in 3 to 5 business days." },
    url: `https://${domain}/products/${slug(name)}-${index}`,
    metadata: { tech_specs: DIMS[kind] },
    media: [{ url: `https://${domain}/images/${index}.jpg` }],
    variants: [
      {
        id: `gid://shopify/ProductVariant/${slug(name)}-${index}`,
        price: { amount: priceCents, currency: "USD" },
        availability: { available: true },
        seller: { domain, name: `Shop ${index}` }
      }
    ],
    ...extra
  };
}

/** Three price points per item: the sum of the middle picks lands in the window a 29500 end table sets. */
export const FAKE_PRICES: Record<string, number[]> = {
  "deep couch": [89900, 119900, 149900],
  "round coffee table": [29900, 49900, 69900],
  "leather ottoman": [14900, 24900, 34900],
  "big rug": [19900, 39900, 59900],
  "end table": [29500]
};

export function fakeSearch(name: string): unknown[] {
  return (FAKE_PRICES[name] ?? []).map((price, i) => fakeCatalogProduct(name, i + 1, price));
}

export function fakeDeps(overrides: Partial<SourcingDeps> = {}): SourcingDeps & { deliveryCalls: string[] } {
  const deliveryCalls: string[] = [];
  return {
    deliveryCalls,
    search: async (item) => fakeSearch(item.name),
    inferKind: async (name) => [...ITEMS, EXTRA].find((i) => i.name === name) ?? { kind: "other", query: name },
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
    startModelGeneration: async () => null,
    evaluatePerCategory: 6,
    ...overrides
  };
}
