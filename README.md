# Room planner

Two people furnish one room together in a browser: a shared whiteboard, a planning agent that sources real products from Shopify merchants, a 2D plan and a 3D room at merchant dimensions, a bill of materials against a budget, and delivery checks against a date. The page exposes its project operations as WebMCP tools, so a browser agent can operate the same project state. `docs/prd.md` (local, not committed) is the specification; the thirteen-scene Playwright flow in `tests/demo.spec.ts` is its acceptance test.

## Requirements

| Dependency | Version used | Why |
| --- | --- | --- |
| Node.js | 26 (`engines` requires 22 or newer) | Next.js app and every script |
| npm | 11 | package installs; `npm ci` reproduces `package-lock.json` |
| Chromium for Playwright | installed by `npx playwright install chromium` | the demo flow and the semantic gate scripts |
| OpenAI API key | any key with access to `gpt-5.6-terra` | the PlanningAgent, board compilation, kind inference, address extraction, visual checks |
| `uv` and Python 3.13 | uv 0.11; `uv sync` installs the pinned Python | the Python side: the Modal client and the commit hooks, pinned in `pyproject.toml` and `uv.lock` |
| Modal account (optional) | `uv run modal token new` | image-to-3D generation; without it every product renders as a colour proxy |
| Aeonik font files (optional) | `Aeonik-Light/Regular/Medium.ttf` in `public/fonts/` | the house typeface; the CSS falls back to Helvetica Neue and Arial |

No database, realtime service, or Shopify credential is needed. Project state lives in the server's memory and resets when the server restarts. Shopify's catalog and storefront endpoints take a hosted UCP agent profile and no API key; the app serves a copy of Shopify's public fixture profile at `/.well-known/ucp-agent-profile.json`.

## Setup

```sh
git clone https://github.com/reversely/webmcp.git && cd webmcp
cp .env.example .env            # then put your OpenAI key in it
npm run setup                   # npm ci, Chromium, uv sync, commit hooks; checks versions and .env
npm run dev                     # http://localhost:3000
```

`npm run setup` runs `scripts/setup.sh`. It is safe to run again; it reports each check and stops on a missing requirement with the command that fixes it.

## Environment variables

Copy `.env.example` to `.env`. The file is gitignored; never commit it.

| Variable | Required | Meaning |
| --- | --- | --- |
| `OPENAI_API_KEY` | yes | read by the Next server at runtime for every model call |
| `MODAL_IMAGE_TO_3D_URL` | no | the deployed Modal endpoint (see below); absent means proxies only |
| `NEXT_PUBLIC_WEBMCP_POLYFILL` | no | `1` loads Chrome's WebMCP polyfill for browsers without `document.modelContext`; the demo passes `?webmcp=polyfill` in the URL instead |

Check a key is present without printing it: `grep -cE '^OPENAI_API_KEY=.+' .env` prints `1`.

## Running

| Command | What it does |
| --- | --- |
| `npm run dev` | dev server on port 3000 (`-- -p 3111` for the port the test scripts expect) |
| `npm run build` then `npm start` | production build and server |
| `npm test` | vitest unit suite (domain, agent, server, UI helpers), no network |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run demo:test` | the Playwright flow: two browser contexts play both people through every scene against the live app, catalog, and model; needs the dev server on 3111 and the OpenAI key; about 4 minutes; videos in `tests/videos/` |
| `npm run test:webmcp` | discovers and executes the seven WebMCP tools through the polyfill |
| `npx tsx scripts/inspect-ui.ts` / `inspect-flow.mts` / `inspect-items.mts` / `inspect-sync.mts` / `inspect-stream.mts` | semantic gates: open the running app and cross-check what is on screen against the API |
| `npm run probe:weekly` | re-checks which discovered Shopify sellers carry the WebMCP loader |

Live tests that hit external services are skipped unless you opt in: `LIVE_SHOPIFY=1`, `LIVE_AGENT=1` (load the key first: `set -a; . ./.env; set +a`).

## 3D generation on Modal

`modal/image_to_3d.py` is a Modal app running TripoSR on one A10G with weights in a Modal volume and no keep-warm. Deploy it once and put the printed endpoint URL in `.env`:

```sh
uv run modal token new                       # once per machine
uv run modal deploy modal/image_to_3d.py     # prints https://<user>--webmcp-image-to-3d-imageto3d-generate.modal.run
```

A cold call takes about 60 s (container start), a warm call about 10 s, at a few cents each. `modal/README.md` has the operating notes.

## Fonts

The house style uses Aeonik (CoType Foundry, commercial). If you have a licence, copy `Aeonik-Light.ttf`, `Aeonik-Regular.ttf`, and `Aeonik-Medium.ttf` into `public/fonts/` (gitignored). `npm run setup` copies them from `~/Library/Fonts` when they are there. Without them the fallback stack applies and nothing else changes.

## Commit hooks

`.pre-commit-config.yaml` runs ruff (lint and format on the Python files), whitespace and end-of-file fixes, JSON, YAML, and TOML checks, and `detect-secrets` against `.secrets.baseline`. The hook tools come from the uv dev group (`uv sync`), and `npm run setup` runs `uv run pre-commit install`. Run `uv run pre-commit run --files <paths>` before staging so a fixer never edits a file mid-commit.

## Layout

```
src/domain/      types, BOM and budget, geometry relations, ranking, products, delivery, 3D proxies
src/agent/       PlanningAgent (OpenAI Agents SDK), sourcing, replacement, delivery, visual, compile
src/commerce/    UCP catalog client with recorded fixtures
src/server/      in-memory state, trace, board sync, 3D jobs
src/webmcp/      the seven WebMCP tools and their registration
src/app/         Next.js routes and the four-stage UI
src/components/  React Three Fiber room
tests/           Playwright flow, WebMCP and failure suites
scripts/         semantic gate scripts, previews, schema generation
spikes/          storefront survey and probes
modal/           image-to-3D endpoint (Python; see pyproject.toml)
evals/           WebMCP tool evals for the Chrome webmcp-evals CLI
```

## Disk

Playwright videos, `.next/`, and `test-results/` grow quickly. `npm run setup` prints free space; clear `test-results/`, `playwright-report/`, and `.next/cache` before a recorded run.
