# Findings that the generated results files do not carry

- The `categories` filter of `search_catalog` takes Shopify Standard Product Taxonomy ids (`ae-2`, `ae-2-1`, `fb`, `aa`, `os`, `tg`, `hg`, `bu`, or the full `gid://shopify/TaxonomyCategory/...`). Category names and path text return zero matches with no message. Measured 2026-08-29 with card-categories-us.csv and a follow-up probe.
- A search result carries no category field (keys: id, title, description, metadata, media, variants, price_range, rating, options); `metadata` holds tech_specs, unique_selling_points, top_features.
- `ships_from` is a list of `{country}` objects; a bare string list is rejected with "value at /catalog/filters/ships_from/0 is not an object".
- `price_tier` accepts `low`, `medium`, `high` and returns a different slice per value for the same query.
- Prices in results are minor units (cents) with a currency; a foreign shop that ships to the address returns its own currency unless `ships_from` restricts the country.
