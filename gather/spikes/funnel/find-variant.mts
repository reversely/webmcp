import { catalogClient } from "@webmcp/shopify-ucp";
const r = await catalogClient().searchCatalog({ query: "cookie favors", filters: { ships_to: { country: "CA", region: "ON", postal_code: "M6H 2A8" }, ships_from: [{ country: "CA" }], available: true, categories: ["fb"], price: { max: 1800 } } as never, pagination: { limit: 5 } });
for (const p of r.products ?? []) { const v = p.variants?.[0]; console.log(v?.seller?.domain, v?.id, p.title.slice(0, 40)); }
