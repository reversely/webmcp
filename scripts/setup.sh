#!/usr/bin/env bash
# Sets up a fresh clone: checks Node, installs npm packages and Chromium, copies fonts when present,
# syncs the uv environment (modal, pre-commit, detect-secrets, ruff), installs the commit hooks, and
# checks .env. Safe to run again.
set -euo pipefail
cd "$(dirname "$0")/.."

ok()   { printf 'ok    %s\n' "$1"; }
warn() { printf 'warn  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; exit 1; }

# Node 22 or newer; the lockfile was produced with npm 11.
node_major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
[ "$node_major" -ge 22 ] || fail "Node 22 or newer is required (found $(node -v 2>/dev/null || echo none)); install from https://nodejs.org"
ok "node $(node -v), npm $(npm -v)"

if [ -f package-lock.json ]; then npm ci --no-audit --no-fund >/dev/null; else npm install --no-audit --no-fund >/dev/null; fi
ok "packages installed"

# esbuild (vitest, tsx) needs its install script approved under npm 11's allow-scripts.
npm approve-scripts esbuild >/dev/null 2>&1 || true
npm rebuild esbuild >/dev/null 2>&1 || true

npx playwright install chromium >/dev/null 2>&1 && ok "Playwright Chromium installed" || warn "Playwright Chromium install failed; run: npx playwright install chromium"

mkdir -p public/fonts
copied=0
for w in Light Regular Medium; do
  src="$HOME/Library/Fonts/Aeonik-$w.ttf"
  if [ -f "$src" ] && [ ! -f "public/fonts/Aeonik-$w.ttf" ]; then cp "$src" public/fonts/ && copied=$((copied+1)); fi
done
if ls public/fonts/Aeonik-Regular.ttf >/dev/null 2>&1; then ok "Aeonik fonts in public/fonts ($copied copied)"; else warn "Aeonik fonts absent; the fallback typeface applies (see README, Fonts)"; fi

# Python side: modal (the image-to-3D endpoint) and the commit hooks, pinned in pyproject.toml and uv.lock.
if command -v uv >/dev/null 2>&1; then
  uv sync --quiet && ok "python env synced (.venv: modal, pre-commit, detect-secrets, ruff)"
  uv run pre-commit install >/dev/null && ok "pre-commit hooks installed"
else
  warn "uv not found; the Modal CLI and the commit hooks are unavailable (brew install uv, then rerun)"
fi

if [ ! -f .env ]; then cp .env.example .env; warn ".env created from .env.example; add your OPENAI_API_KEY"; fi
if grep -qE '^OPENAI_API_KEY=.+' .env; then ok "OPENAI_API_KEY set in .env"; else warn "OPENAI_API_KEY missing in .env; the agent, compile, and visual checks will not run"; fi
if grep -qE '^MODAL_IMAGE_TO_3D_URL=.+' .env; then ok "MODAL_IMAGE_TO_3D_URL set; 3D generation enabled"; else warn "MODAL_IMAGE_TO_3D_URL missing; products render as colour proxies (see README, 3D generation)"; fi

npx tsc --noEmit >/dev/null && ok "typecheck clean" || fail "typecheck failed; run npm run typecheck"
printf 'disk  %s free on this volume\n' "$(df -h . | awk 'NR==2{print $4}')"
echo "next  npm run dev   (or: npm run dev -- -p 3111 for the test scripts)"
