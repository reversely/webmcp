# Findings outside the generated results files

- The `categories` filter of `search_catalog` takes Shopify Standard Product Taxonomy ids (`ae-2`, `ae-2-1`, `fb`, `aa`, `os`, `tg`, `hg`, `bu`, or the full `gid://shopify/TaxonomyCategory/...`). Category names and path text return zero matches with no message. A run on 2026-08-29 against card-categories-us.csv and a follow-up probe measured this.
- A search result carries no category field (keys: id, title, description, metadata, media, variants, price_range, rating, options); `metadata` holds tech_specs, unique_selling_points, top_features.
- `ships_from` takes a list of `{country}` objects; the endpoint rejects a bare string list with "value at /catalog/filters/ships_from/0 is not an object".
- `price_tier` accepts `low`, `medium`, `high` and returns a different slice per value for the same query.
- Prices in results arrive in minor units (cents) with a currency; a foreign shop that ships to the address returns its own currency unless `ships_from` restricts the country.
- The `price` filter of `search_catalog` is in minor units (cents), the unit results carry. The price rows in queries.csv sent dollars (10 and 25), so they asked for products under ten and twenty-five cents; their results are not comparable with the other rows. Measured 2026-08-30 when a Gather search under "18" returned one to three products per query and under "1800" returned 74.
