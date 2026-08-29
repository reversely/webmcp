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

## Steps 5 to 7

Run on 2026-08-27; see steps 11 and 12 below.

## Step 8 (2026-08-28): merchants discovered through Global Catalog, no hard-coded list

`discover.ts` runs `search_catalog` for the five demo categories (limit 50, `ships_to` US/NY/10003,
in stock), collects every seller domain, then probes each storefront and runs `create_checkout` on
one available variant with the demo address. Full table in `discovered.md`, raw in `discovered.json`.

| Measure | Result |
| --- | --- |
| Sellers returned across the five searches | 73 |
| Sellers answering `/api/ucp/mcp` with 13 tools | 73 of 73 |
| Sellers carrying Shopify's inline WebMCP loader (Liquid storefronts) | 60 of 73; adapter v0.1.1. The 13 without are headless fronts or unpublished `myshopify.com` hosts |
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

## Step 9 (2026-08-28): why the adapter looked absent, and how to filter for Liquid

The adapter is loaded by an inline script Shopify injects into every Liquid storefront (rolled out
2026-08-21 per the changelog; a community thread from 2026-07-17 saw an earlier version). The
loader runs `typeof (document.modelContext || navigator.modelContext)?.registerTool == "function"`
and only in a WebMCP-capable browser appends `<script type="module" src="https://cdn.shopify.com/storefront/webmcp/webmcp-0.1.1.js">`. A curl or a non-WebMCP browser never sees the CDN URL. The
marker to grep for is the loader's localStorage key, `shopify:webmcp_adapter_loaded`.

Global Catalog has no storefront-type filter. Its `search_catalog` filters are `categories`, `price`,
`available`, `shops` (by shop GID, up to 1000), `condition`, `ships_to`, `ships_from`, `attributes`,
`rating`, `price_tier`. The way to restrict to Liquid sellers is therefore two-step: discover sellers
as in step 8, fetch each seller's homepage once and keep those with the loader marker, then pass
their shop GIDs (`variants[].seller.id`) in `filters.shops` on later searches. Headless sellers
(rugsusa.com, burrow.com, castlery.com) and stores still on a password page lack the marker.

## Step 10 (2026-08-28): discovery at five pages per category

`PAGES=5 npx tsx spikes/storefront-survey/discover.ts` (about 20 minutes: one homepage fetch, one
`tools/list`, and one `create_checkout` per seller).

| Measure | One page (step 8) | Five pages |
| --- | --- | --- |
| Products returned | 250 | 1,247 |
| Distinct sellers | 73 | 293 |
| Sellers with the Liquid WebMCP loader | 60 | 280 |
| Sellers answering UCP with 13 tools | 73 | 293 |
| Products with parseable dimensions | 103 | 551 (147 sellers have at least one) |
| Sellers covering 3+ demo categories | 5 | 26 (westwing, arhaus, poly-bark, modway, daalshome, burrow cover 4) |
| Sellers returning shipping options from `create_checkout` | 31 | 156 |
| Sellers whose option text carries a delivery window or duration | 11 | 55 |
| Sellers that are Liquid, have dimensions, and return delivery text | | 29 |

The catalog's own `total_count` is roughly 370 to 400 per category query, so five pages cover about
two thirds of each; the cursor runs to 1,000. Seller count grows almost linearly with pages because
most sellers appear once.

## Step 11 (2026-08-27): Storefront GraphQL `unstable` cart estimate (survey step 5)

`npx tsx spikes/storefront-survey/cart-estimate.ts` against five Liquid sellers from `discovered.md`,
chosen because their `create_checkout` option text carries a delivery duration or window (Modway,
Tribesigns, Nathan James) or because they were in the hand-picked step 3 set (daals, Floyd). The
script scrapes the token, takes the first available variant from `/products.json`, and runs
`cartCreate` on `https://{shop}/api/unstable/graphql.json` with the 10003 address twice: once as
`buyerIdentity.deliveryAddressPreferences` (the shape the spike plan names; `MailingAddressInput`,
deprecated after API 2025-01) and once as `delivery.addresses` (`CartDeliveryAddressInput`, the
current shape). Both shapes are still accepted on `unstable` and returned identical options.

| Merchant | Token in page | Tokenless `{ shop { name } }` | Delivery options on the cart | `minEstimatedDeliveryDate` / `maxEstimatedDeliveryDate` | UCP checkout option text (step 8) |
| --- | --- | --- | --- | --- | --- |
| modway.com | `shopify-features` `accessToken` | answers | Standard $0 | null / null | `Standard (3 to 12 business days via Standard)` |
| tribesigns.com | `shopify-features` `accessToken` | answers | Standard $0 | null / null | `Standard (Tuesday, September 1–Wednesday, September 2 via Standard)` |
| www.daals.com | `shopify-features` `accessToken` | answers | cart created, 0 delivery groups | no option to read | `Standard Delivery (3 to 8 business days via USA-MULTIBOX)` |
| floydhome.com | `shopify-features` `accessToken` | answers | cart created, 0 delivery groups | no option to read | `Total Shipping` $299 (step 3) |
| nathanjames.com | `shopify-features` `accessToken` | answers | FedEx Ground ZS $0 | null / null | `Delivered in 8 to 11 days` |

Findings:

- Token: no seller embeds `storefrontAccessToken` in a theme bundle. Every Liquid storefront embeds
  its public Storefront token as `accessToken` inside `<script id="shopify-features"
  type="application/json">` in the homepage HTML (Shopify's own scripts read it). Headless fronts
  embed theirs in the app bundle (burrow.com: `storefrontAccessToken` in the Next.js data). The
  token turned out to be optional: the shop's own domain answers `/api/unstable/graphql.json` with
  no `X-Shopify-Storefront-Access-Token` header.
- Dates: `null` on every option for all five, including Tribesigns, whose checkout tool option
  title carries a two-day window for the same address. The Storefront cart names the option
  `Standard` and drops the window. The estimate fields depend on the merchant configuring
  processing and transit times in Shopify admin, which these merchants have not done; their delivery
  text comes from the shipping rate name.
- Two of five carts (daals, Floyd) return no delivery group at all until the cart is taken to
  checkout, so there is nothing to read even when the fields were populated.

Consequence: source 2 in PRD Section 10 stays below the checkout tool, and PRD Section 10 now
records the token location and the tokenless behaviour so #28 needs no bundle scraping.

### Survey step 6 (Playwright checkout run): superseded

Step 8 showed that `create_checkout` on `/api/ucp/mcp` returns the same shipping option text a
shopper sees on the hosted checkout page, without a browser session and without the captcha and
challenge scripts the step 3 checkout HTML carries. A Playwright run to the shipping step would
measure bot protection on a path the planner does not use, so it was not run. The browser agent's
`proceed_to_checkout` path (PRD Section 10 source 4) reads the option text off the page it is
already on.

## Step 12 (2026-08-27): weekly adapter probe (survey step 7)

`npm run probe:weekly` runs `probe.sh` over the 293 sellers in `discovered.json`, writes
`probes/{date}.txt`, prints a dated summary row, and diffs the loader column against
`discovered.json` and against the previous dated file. `probe.sh` gained three columns: `http`
(homepage status), `loader` (the `shopify:webmcp_adapter_loaded` marker from step 9), and the
`shopify-features` token, printed with its first four characters only.

| Date | Run | Sellers probed | Homepage 200 | Liquid loader marker | Adapter CDN URL in server HTML | UCP 200 |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-08-27 | parallel, 8 jobs (partial) | 293 | 25 | 25 | 0 | 286 |
| 2026-08-27 | serial, after the 429 lifted (partial) | 293 | 16 | 15 | 0 | 15 |

Both runs are partial. The first used eight parallel `probe.sh` processes; Shopify's edge answered
HTTP 429 to every storefront GET after about 25 sellers and kept doing so for eight minutes (UCP
`tools/list` POSTs were unaffected: 286 of 293 answered 200). The serial rerun started when
floydhome.com answered 200 again, but 277 of 293 curls then failed with no HTTP status at all
(`http=000`, including the UCP POST), so the block moved from 429 to a dropped connection. Over the
homepages that did answer, every Liquid seller carried the loader marker and none carried the
adapter CDN URL in server HTML, matching step 9; the one row that differs from `discovered.json`
(bellamiacollections.com, loader true to false) is a shop whose HTML no longer references
`cdn.shopify.com` and whose UCP endpoint did not answer, so it reads as a migrated or offline shop,
not a loader change. `probe.sh` now prints the homepage status and the weekly diff only counts rows
that answered 200; the run is serial with a one-second pause. Rerun from a quiet IP with
`npm run probe:weekly`; it overwrites `probes/{date}.txt` and prints the row for this table.
Cadence: weekly, next due 2026-09-03.
