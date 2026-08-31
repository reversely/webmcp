# Customily WebMCP adapter

`webmcp-customily.js` registers three batch tools on `document.modelContext` so a browser agent can
personalize a Customily product on the Shopify storefront through a structured contract. The
tool bodies stay generic; every DOM selector lives in the `PRODUCT_ADAPTERS` map at the top of
the file, keyed by the numeric Shopify product id, so supporting a new product means adding one
adapter entry. The map covers the crewneck (10242071789817), the hoodie (10243540517113), and
the mug (10243494084857).

## Installation in the Shopify theme

1. In the Shopify admin open Online Store, then Themes, then Edit code.
2. Upload `webmcp-customily.js` to the theme's `assets` folder.
3. Load it on the product template by adding this line before `</body>` in `layout/theme.liquid`
   (or in the product section's liquid file to limit it to product pages):

   ```liquid
   <script src="{{ 'webmcp-customily.js' | asset_url }}" defer></script>
   ```

4. The page needs `document.modelContext`. A browser with native WebMCP support provides it;
   otherwise load the polyfill (`gather/src/webmcp/polyfill.js` in this repo) from the theme's
   assets on the same template, before the adapter script.

Schema and validation answer for any adapted product id from any page on the shop's origin;
`create_personalized_batch` drives the DOM, so it runs only on its product's own page and any
other page gets a structured error naming the mismatch.

## Tools

### get_personalization_schema

Takes `{ product_id }`. Returns the product's personalization contract from the adapter
configuration: each field's key, kind, label, control, required flag, and notes, plus the
product's variants when the storefront's product JSON answers, and the currently selected
variant id when the call runs on that product's page. An adapted product with no fields returns
an empty field list.

### validate_personalized_batch

Takes `{ product_id, items, delivery }`. Each item is
`{ recipient_ref, variant_id, personalization }`, where `personalization` maps field keys from
the schema to string values; `delivery` is `{ type: "single_address", address_ref }`. The tool
dry-runs the batch with reads only: field keys must exist, required fields must be present,
values must fit each field's shape and configured length, `variant_id` must resolve against the
product JSON, and, on the product's own page, each used field's control must be rendered.
Returns `{ product_id, valid, items, delivery_issues, delivery }` with per-item `issues`, and
marks the result `isError` when anything fails.

### create_personalized_batch

Takes `{ batch_id, product_id, items, delivery, idempotency_key }` and runs on the product's
page. Per item it selects the Shopify variant through the theme's option radios, fills each
personalization field through its control adapter, waits for the Customily preview canvas, and
presses Customily's own add-to-cart button; an item that fails any step joins `blocked` with its
issues and the batch continues. Returns
`{ batch_id, status: "prepared", ready, blocked, subtotal, currency, checkout_url, preview_urls, delivery }`:
`subtotal` and `currency` come from `/cart.js`, `preview_urls` maps each ready `recipient_ref`
to the `_customily-preview` property Customily writes on its cart line, and the result is
`isError` when no item reached the cart.

Idempotency: after each successful add the tool records `recipient_ref` to cart-line-key in
`sessionStorage` under the `idempotency_key`. A repeated call with the same key returns the
recorded lines with `replayed: true` and presses nothing, and a retry after a partial failure
re-adds only the recipients whose lines are absent. The key holds only the `idempotency_key` and
not the cart token, because Shopify rotates the cart token when the first line lands in an empty
cart; cart identity is re-checked on replay against the live `/cart.js` lines, so a cleared or
replaced cart re-adds rather than replaying a stale line. The record lives in this tab's session,
so a fresh tab clears the guard.

`checkout_url` points at `/checkout` on the shop's origin. Shopify binds the checkout to the
cart cookie of the browser session that added the lines, so the URL works in that session and
shows an empty cart anywhere else. The storefront cannot set a delivery address before
checkout, so `delivery` rides through the tools untouched and the address is entered on the
checkout page.

## Product notes

The hoodie's `photo` field takes an https URL or a data URL: the control fetches the image in
the page, wraps it in a `File`, and hands it to Customily's file input through a `DataTransfer`,
so the vendor's upload handler runs as it does for a human pick. A cross-origin URL without CORS
headers fails the fetch with a per-item issue; a data URL always loads.

The mug's adapter entry carries the same image field, and the storefront page renders no
Customily controls as of 2026-08-31 because the template has not propagated, so validate and
create answer with a per-item `control not rendered` issue on the mug page until it does.

## Vendor execution

`gather/scripts/personalize-agent.ts` reads a gift's manifest from Gather's tokenized MCP endpoint
and carts every ready row through `create_personalized_batch`. It sends one item per product-page
load and reloads the page between items: the Customily location widget commits coordinates only on a
fresh page (a reused location field never re-commits, and an in-page tool cannot reload itself), so
the reset lives in the driver while the calls share one `batch_id`, `idempotency_key`, and cart. It
then posts one update carrying the `checkout_url` and the per-recipient preview URLs.

Because the shop runs in test mode, the run then drives the returned checkout toward a placed order
with Shopify's Bogus Gateway. The checkout step is best-effort: a blocked or changed checkout returns
no order and the run keeps the batch and its cart lines, so `placeOrder: false` (the spec's
`CUSTOMILY_ORDER=0`) stops at the cart. Two facts about the live store shape the flow: it ships to
Canada only, so a US event venue falls back to a Canadian placeholder ship-to for the test order
(the batch's `delivery` object still carries the real intent), and its newer React checkout
client-validates the card, so the run enters a Luhn-valid test number (`CUSTOMILY_TEST_CARD`, default
`4242424242424242`) rather than the classic Bogus `1`.

Known limitation (2026-08-31): that React checkout accepts the address, the shipping rate, and the
card number, but its expiry and security-code card iframes resist synthetic key input, so the order
does not reach the confirmation page under automation and the run posts no order name. The batch and
its cart lines are the deliverable and are asserted regardless; the placed-order assertion runs only
when the checkout completes, and `CUSTOMILY_REQUIRE_ORDER=1` turns a missing order into a failure.

## Testing

`gather/tests/customily-live.spec.ts` smoke-tests the adapter against the live storefront. It
runs only with `LIVE_CUSTOMILY=1`, adds one line each on the crewneck and the hoodie, verifies
the idempotency replay adds nothing, and never opens checkout:

```sh
LIVE_CUSTOMILY=1 npx playwright test tests/customily-live.spec.ts
```
