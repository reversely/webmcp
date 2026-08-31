# WebMCP sandbox

A workspace of WebMCP apps: pages that expose their operations as tools through `document.modelContext`, so a browser agent can operate the same state a person does. Each app is an npm workspace with its own Next.js server, tests, and Playwright suite; the toolchain, commit hooks, agent conventions, and `.env` names are shared at the root.

| App | What it is | Port |
| --- | --- | --- |
| [`3droom-concept/`](3droom-concept/README.md) | two people furnish a room: shared whiteboard, planning agent sourcing real Shopify products, 2D plan and 3D room at merchant dimensions, bill of materials against a budget, delivery checks | 3000 (tests expect 3111) |
| [`gather/`](gather/README.md) | RSVP records as tools: an organizer's agent shops for the guests at a Shopify store, the print shop, and a Customily shop, and maps RSVP answers into personalization fields; vendors read and post through the same tools | 3113 |
| [`printshop/`](printshop/README.md) | a personalized-stationery vendor whose tools take a name per unit: registered in its page and served from its server, so Gather's agent quotes, orders, and follows a batch | 3114 |
| [`app-template/`](app-template/README.md) | the starting point for a new app: one page, one piece of state, two tools, a unit test, a Playwright test, an evals file | 3112 |

## Requirements

| Dependency | Version used | Why |
| --- | --- | --- |
| Node.js | 26 (`engines` requires 22 or newer) | every app and script |
| npm | 11 | workspaces; `npm ci` reproduces `package-lock.json` |
| Chromium for Playwright | `npx playwright install chromium` | the apps' Playwright suites |
| `uv` and Python 3.13 | uv 0.11 | the Python side: the commit hooks and the room planner's Modal client, pinned in `pyproject.toml` and `uv.lock` |
| OpenAI API key | access to `gpt-5.6-terra` and `gpt-5.6-luna` | the room planner's planning agent and gather's curation agent; the template needs none |
| Modal account (optional) | `uv run modal token new` | the room planner's image-to-3D endpoint |
| Aeonik font files (optional) | `Aeonik-Light/Regular/Medium.ttf` | the house typeface; the CSS falls back to Helvetica Neue and Arial |

## Setup

```sh
git clone https://github.com/reversely/webmcp.git && cd webmcp
cp .env.example .env            # then put your OpenAI key in it
npm run setup                   # npm ci for every app, Chromium, uv sync, hooks, fonts, .env links
npm run dev -w 3droom-concept   # or: npm run dev -w app-template -- -p 3112
```

`npm run setup` runs `scripts/setup.sh`. It is safe to run again. The one `.env` at the root is linked into each app (`<app>/.env -> ../.env`), so every app reads the same names. The file is gitignored; never commit it.

## Environment variables

| Variable | Used by | Meaning |
| --- | --- | --- |
| `OPENAI_API_KEY` | 3droom-concept, gather | every model call |
| `MODAL_IMAGE_TO_3D_URL` | 3droom-concept | the deployed Modal endpoint; absent means colour proxies |
| `PRINTSHOP_URL` | gather | the print shop's base URL; absent means `http://localhost:3114` |
| `CUSTOMILY_SHOP_URL` | gather | the Customily-fronted shop's base URL; absent means the custom-shop source returns nothing |
| `NEXT_PUBLIC_WEBMCP_POLYFILL` | every app | `1` loads Chrome's WebMCP polyfill for browsers without `document.modelContext`; the suites pass `?webmcp=polyfill` in the URL instead |

Check a key is present without printing it: `grep -cE '^OPENAI_API_KEY=.+' .env` prints `1`.

## Commands at the root

| Command | What it does |
| --- | --- |
| `npm test` | every app's vitest suite |
| `npm run typecheck` | `tsc --noEmit` in every app |
| `npm run <script> -w <app>` | one app's script (`dev`, `build`, `test:webmcp`, `demo:test`, `demo:script`, ...) |
| `uv run pre-commit run --files <paths>` | the hooks on chosen files before staging |

## Adding an app

1. Copy `app-template/` to a new folder and rename `name` in its `package.json`.
2. Add the folder to `workspaces` in the root `package.json` and run `npm install`.
3. Give it a port of its own in `playwright.config.ts` and its README.
4. `npm run setup` links `.env` and copies the fonts into it.

## Commit hooks and layout

`.pre-commit-config.yaml` runs ruff (Python), whitespace and end-of-file fixes, JSON, YAML, and TOML checks, and `detect-secrets` against `.secrets.baseline`. One ticket is one commit to `main`; the message body ends with `closes #N`.

```
3droom-concept/  the room planner (see its README for the layout inside)
gather/          the RSVP app
printshop/       the stationery vendor
packages/        @webmcp/shopify-ucp, the shared Shopify client
app-template/    the starting point for a new app
scripts/         setup.sh
pyproject.toml   the uv project: modal, pre-commit, detect-secrets, ruff
docs/            the local session log (gitignored)
```

## Disk

Playwright videos, `.next/`, and `test-results/` in each app grow quickly; `npm run setup` prints free space. Clear `<app>/test-results`, `<app>/.next/cache`, and old `<app>/tests/videos/*.webm` before a recorded run.
