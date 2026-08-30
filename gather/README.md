# Gather

An RSVP application whose guest records are tools: registered as WebMCP tools in the organizer's page and served over HTTP from the server, with a planning agent that shops for the guests at a Shopify store. The specification is `docs/prd.md` (local). Scaffolded from `app-template`; the notes page is the placeholder until the first ticket lands.

## What is in it

| Path | Role |
| --- | --- |
| `src/notes/store.ts` | the page's state and the two functions both the UI and the tools call |
| `src/webmcp/tools.ts` | the tool definitions (name, description, input schema) and the result shaping |
| `src/webmcp/register.ts` | registration on `document.modelContext` tied to an `AbortSignal` |
| `src/app/webmcp-provider.tsx` | loads Chrome's polyfill when `?webmcp=polyfill` is on the URL and shows the tool status |
| `src/app/page.tsx` | the page |
| `tests/webmcp.spec.ts` | Playwright: the tools are listed, a call changes the page, an empty note is an error |
| `evals/webmcp/evals.json` | two cases for the Chrome `webmcp-evals` CLI |

## Running

From the repo root after `npm run setup`:

```sh
npm run dev -w gather -- -p 3113     # http://localhost:3113
npm test -w gather                   # vitest
npm run test:webmcp -w gather        # Playwright through the polyfill (starts the server on 3113)
```

## Conventions carried over

The `webmcp` skill's rules: one tool per user-visible action, the description and schema are the whole contract, MCP-shaped results with `isError` on failure, registration tied to lifecycle. The `light-enterprise-ui` tokens in `src/app/tokens.css`; Aeonik from `public/fonts/` when present, with the fallback stack otherwise.
