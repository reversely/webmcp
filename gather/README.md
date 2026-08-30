# Gather

An RSVP application whose guest records are tools: registered as WebMCP tools in the organizer's page and served over HTTP from the server to token holders, with a planning flow that shops for the guests at a Shopify store through Shopify's agent interface. The specification is `docs/prd.md` (local). One workspace of the [WebMCP sandbox](../README.md); the toolchain, hooks, and `.env` are set up at the repo root with `npm run setup`.

## What is in it

| Path | Role |
| --- | --- |
| `src/domain/` | records (`types.ts`), the store and change log (`store.ts`), value types (`values.ts`), the filter grammar (`filter.ts`), the gift plan (`gifts.ts`), the question library and synonym rows as data |
| `src/server/` | the operations behind the routes and the tools (`api.ts`), the cart operations (`cart-api.ts`), the MCP endpoint with tokens (`mcp.ts`), the hook that re-syncs carts after a reply |
| `src/agent/` | the card rows (`cards.json`), catalog search, delivery probe, and ranking (`search.ts`), the cart at the shop (`cart.ts`) |
| `src/webmcp/` | the tool definitions as data mapped to routes (`tools.ts`), registration on `document.modelContext` |
| `src/app/` | the draft page, the invite, the dashboard (Overview, Guest Experience), and the API routes |
| `scripts/vendor-agent.mts` | a scripted vendor's agent against the endpoint: manifest, change feed, confirmation, shipped |
| `tests/` | Playwright: draft, invite, overview, experience, tools through the polyfill, the vendor agent, and the live demo |
| `spikes/favor-vendors/` | the Global Catalog survey for favor merchants, New York and Toronto |

## Running

From the repo root:

```sh
npm run dev -w gather -- -p 3113            # http://localhost:3113
npm test -w gather                          # vitest (LIVE_SHOPIFY=1 adds the live catalog and cart tests)
npm run test:e2e -w gather                  # the Playwright suites except the demo; starts the server on 3113
npx playwright test tests/demo.spec.ts      # from gather/: the live demo, recorded to tests/videos
npx tsx gather/scripts/vendor-agent.mts http://localhost:3113 <event id> <token id> <gift id> confirm
```

The endpoint: `POST /api/events/{id}/mcp` with `Authorization: Bearer <token id>` answers `initialize`, `tools/list`, and `tools/call`; `POST /api/events/{id}/tokens` issues a token (holder, gift ids, readable definitions, callable tools, expiry). The demo never completes a checkout; the live tests cancel the carts they create.
