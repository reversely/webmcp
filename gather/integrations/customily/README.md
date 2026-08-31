# Customily WebMCP adapter

`webmcp-customily.js` registers four tools on `document.modelContext` so a browser agent can
personalize a Customily product on the Shopify storefront through a structured contract. The
tool bodies stay generic; every DOM selector lives in the `PRODUCT_ADAPTERS` map at the top of
the file, keyed by the numeric Shopify product id, so supporting a new product means adding one
adapter entry.

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

The adapter registers tools only on a page whose product form carries a product id present in
`PRODUCT_ADAPTERS`; on any other page every tool answers with a structured error naming the
missing adapter.

## Tools

### get_personalization_schema

Returns the personalization contract of the current product: each field's key, kind, label,
control, required flag, and notes, plus the variant option values and the currently selected
variant id. Call it first; `configure_personalized_unit` takes its field keys.

### configure_personalized_unit

Takes `{ recipient_ref, variant_id, values }`. Selects the requested Shopify variant by driving
the theme's option radios until the product form's hidden variant id matches, fills each field
through its control adapter with the input, change, and blur events Customily listens for, picks
the first geocoder suggestion for the location field, waits for the Customily preview canvas to
render, and checks that every required field holds a value. Returns the applied configuration
with a preview id, or `isError` with per-field messages.

### get_personalization_preview

Takes `{ recipient_ref }`. Reports whether the preview canvas for the configured unit is
rendered: `{ recipient_ref, ready, preview_id, preview_url?, errors }`. `preview_url` carries a
small thumbnail data URL of the preview canvas when the canvas allows export.

### add_personalized_unit_to_cart

Takes `{ recipient_ref }`. Presses Customily's own add-to-cart button, waits for the new line to
appear in `/cart.js`, and returns the cart line key, variant id, quantity, and line item
properties so the caller can tie the cart line to its recipient. The page holds one live
Customily configuration at a time, so configure and add one unit before configuring the next.

## Testing

`gather/tests/customily-live.spec.ts` smoke-tests the adapter against the live storefront. It
runs only with `LIVE_CUSTOMILY=1` and stops short of the cart:

```sh
LIVE_CUSTOMILY=1 npx playwright test tests/customily-live.spec.ts
```
