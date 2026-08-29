# App template

The starting point for a new WebMCP app in this workspace: a Next.js page with one piece of state (a list of notes), a button that changes it, and two WebMCP tools (`add_note`, `list_notes`) that call the same functions the button calls. Copy the folder, rename it, add it to `workspaces` in the root `package.json`, and replace the notes with the app's own state.

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
npm run dev -w app-template -- -p 3112     # http://localhost:3112
npm test -w app-template                   # vitest
npm run test:webmcp -w app-template        # Playwright through the polyfill (starts the server on 3112)
```

## Conventions carried over

The `webmcp` skill's rules: one tool per user-visible action, the description and schema are the whole contract, MCP-shaped results with `isError` on failure, registration tied to lifecycle. The `light-enterprise-ui` tokens in `src/app/tokens.css`; Aeonik from `public/fonts/` when present, with the fallback stack otherwise.
