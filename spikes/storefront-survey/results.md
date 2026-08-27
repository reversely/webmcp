# Storefront survey results

Probed 2026-08-27 with `probe.sh` and hand-written JSON-RPC calls. Agent profile used for every UCP
call: `https://shopify.dev/ucp/agent-profiles/2026-04-08/valid-with-capabilities.json`, a fixture
Shopify hosts for testing. The planner serves a copy at `/.well-known/ucp-agent-profile.json`.

## Step 1: which storefronts are Shopify, and what they answer

| Domain | Shopify | `/products.json` | `/api/ucp/mcp` `tools/list` | WebMCP adapter on page |
| --- | --- | --- | --- | --- |
| burrow.com | yes | no | 13 tools | no |
| floydhome.com | yes | yes | 13 tools | no |
| sabai.design | yes | yes | 13 tools | no |
| insideweather.com | yes | yes | 13 tools | no |
| sundays-company.com | yes | yes | 13 tools | no |
| maidenhome.com | yes | yes | 13 tools | no |
| benchmademodern.com | yes | yes | 13 tools | no |
| albanypark.com | yes | yes | 13 tools | no |
| medleyhome.com | yes | yes | 13 tools | no |
| rugsusa.com | headless Shopify | yes | 13 tools | no |
| castlery.com, allform.com, ruggable.com, kaiyo.com, apt2b.com | no | | | |

The 13 tools on every storefront `/api/ucp/mcp`: `search_catalog`, `lookup_catalog`, `get_product`,
`create_cart`, `get_cart`, `update_cart`, `cancel_cart`, `create_checkout`, `get_checkout`,
`update_checkout`, `complete_checkout`, `cancel_checkout`, `get_order`. None needs a Bearer token;
every `tools/call` needs `meta.ucp-agent.profile`.

## Step 2: product fields (dimensions)

| Source | Call | Dimension field present |
| --- | --- | --- |
| Global Catalog | `search_catalog` "three seat sofa", `ships_to` US/NY/10003 | `metadata.tech_specs` on 3 of 3 results; 1 of 3 (daalshome, "Campbell 3 Seater") carries `Dimensions: 197 x 134 x 90 cm`; the other two list seating, material, colour only |
| Storefront Catalog (Floyd) | `search_catalog` "sofa" | `metadata` empty |
| Storefront Catalog (Floyd) | `get_product` gid 8457432072354 | no `metadata`; `description.html` has no dimension text |
| Floyd product page HTML | scrape | dimensions absent from server HTML (rendered client-side) |

Global Catalog `search_catalog` also accepts `catalog.like` with an image for visual search. The
`ships_to` filter schema says region and postal code "improve delivery estimate fidelity", but no
delivery field appeared in any product or variant object returned.

## Step 3: delivery evidence through UCP

Floyd, `create_cart` then `update_cart` with a shipping destination: `fulfillment.methods` stays `[]`.
The cart never computes delivery options.

`create_checkout` with line item, buyer email, and a destination that includes `phone_number`:

| Merchant | Status | Shipping options returned | Date field |
| --- | --- | --- | --- |
| floydhome.com | `requires_escalation` | "Total Shipping", $299.00 | none |
| albanypark.com | `requires_escalation` | "White Glove Delivery" $0, "Threshold Delivery" $0 | none |
| sundays-company.com | `requires_escalation` | "Free Premium Delivery" $0 | none |
| sabai.design | `requires_escalation` | none | none |
| medleyhome.com | `requires_escalation` | none | none |
| benchmademodern.com | `requires_escalation` (+ `validation_custom`) | none | none |
| maidenhome.com | `requires_escalation` | none | none |

Every response carries `extension_interaction_required` (payment step) and a `continue_url` to the
hosted checkout. The option objects have `id`, `title`, `description`, `totals` and nothing temporal.
Floyd's checkout also returned tax ($220.90) and a total, so the UCP checkout path gives a landed
price without an order.

The `continue_url` checkout HTML (338 KB) renders "Enter your shipping address to view available
shipping methods" server-side and includes captcha and challenge scripts; the estimated-delivery line,
where a merchant configures one, renders client-side after address entry.

## What this meant for PRD Section 10 after seven hand-picked merchants (superseded by step 8)

1. No Shopify API path returned a delivery date for any of the seven merchants. UCP checkout returns
   shipping options and cost; the option title sometimes encodes the service level ("White Glove",
   "Threshold") but never a date.
2. `confirmed` can only come from a merchant that configured delivery dates, read off the hosted
   checkout page after address entry in a real browser. None of the seven probed merchants is known
   to have done so.
3. `likely` from merchant text (shipping policy link is returned on every cart and checkout under
   `links[type=shipping_policy]`) is the path with data for every merchant.
4. Dimensions come from Global Catalog `tech_specs` for some merchants and from nowhere in the API for
   others; extraction over description and page text stays necessary.

## Not yet run

- Step 5: Storefront GraphQL `unstable` cart `minEstimatedDeliveryDate` (needs each shop's public
  Storefront token from its page bundle).
- Step 6: Playwright run through a hosted checkout to the shipping step.
- Step 7: weekly adapter probe.

## Step 8 (2026-08-28): merchants discovered through Global Catalog, no hard-coded list

`discover.ts` runs `search_catalog` for the five demo categories (limit 50, `ships_to` US/NY/10003,
in stock), collects every seller domain, then probes each storefront and runs `create_checkout` on
one available variant with the demo address. Full table in `discovered.md`, raw in `discovered.json`.

| Measure | Result |
| --- | --- |
| Sellers returned across the five searches | 73 |
| Sellers answering `/api/ucp/mcp` with 13 tools | 73 of 73 |
| Sellers loading the storefront WebMCP adapter | 0 of 73 |
| Products returned | 250, of which 103 have dimensions parseable from `tech_specs` or `description.plain` |
| Sellers covering 3+ demo categories | westwing-main-stage (4), daalshome, ornate-furniture, thuma-bed, burrow-prod |
| `create_checkout` returning shipping options | 31 sellers |
| Options whose title carries a delivery window or duration | 14, on 11 sellers |

Delivery text seen in option titles, all parseable by `normalizeDeliveryEvidence`:
`Standard (Wednesday, September 2–Thursday, September 3 via Standard)`,
`Economy (Friday, September 4–Thursday, September 10 via Economy)`, `Delivered in 8 to 11 days`,
`Standard (3 to 5 business days via Standard)`, `Ground Advantage (3 business days via
GroundAdvantage)`, `Standard Fast Shipping (Ships in 1 business day via Standard Fast Shipping)`.

Consequence for PRD Section 10: the checkout tool on `/api/ucp/mcp` returns the same option text a
shopper sees, with no browser session and no captcha, for the merchants that configured delivery
expectations. It is the primary evidence source; the hosted checkout page adds nothing beyond it.
