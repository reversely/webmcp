#!/bin/bash
# Weekly WebMCP adapter probe (#14 step 7). Runs probe.sh over every seller in discovered.json,
# saves the dated output under probes/, and diffs the loader column against discovered.json and
# against the previous dated probe. Run: npm run probe:weekly
# Serial by design: eight parallel probe.sh processes on 2026-08-27 drew HTTP 429 from Shopify's
# edge for every shop after about 25 sellers, and the limit held for minutes afterwards. A run
# takes roughly 15 minutes at DELAY=1 (seconds between sellers, passed through to probe.sh).
set -euo pipefail
cd "$(dirname "$0")"
today=$(date +%F)
mkdir -p probes
out="probes/$today.txt"
prev=$(ls probes/*.txt 2>/dev/null | grep -v "$out" | tail -1 || true)

node -e 'for (const r of require("./discovered.json")) console.log(r.public_host || r.domain)' | sort -u \
  | xargs -n 20 ./probe.sh | sort > "$out"

total=$(wc -l < "$out" | tr -d ' ')
ok=$(grep -c "http=200" "$out" || true)
loader=$(grep -c "loader=[1-9]" "$out" || true)
cdn=$(grep -vc "webmcp=none" "$out" || true)
ucp=$(grep -c "ucp_mcp=200" "$out" || true)
echo "| $today | $total | $ok | $loader | $cdn | $ucp |"
echo "(date | sellers probed | homepage 200 | Liquid loader marker | adapter CDN URL in server HTML | UCP 200)"

# Loader column vs discovered.json, over sellers whose homepage answered 200 this run.
node -e '
const fs = require("fs");
const base = new Map(require("./discovered.json").map((r) => [r.public_host || r.domain, r.webmcp_loader]));
const now = new Map(fs.readFileSync(process.argv[1], "utf8").trim().split("\n").filter((l) => /http=200/.test(l)).map((l) => [l.split(" | ")[0], /loader=[1-9]/.test(l)]));
const changes = [];
for (const [host, had] of base) if (now.has(host) && now.get(host) !== had) changes.push(`${host}: loader ${had} -> ${now.get(host)}`);
console.log(`loader column vs discovered.json: ${changes.length} changed of ${now.size} answering`);
for (const c of changes) console.log("  " + c);
' "$out"

if [ -n "$prev" ]; then
  echo "loader column vs $prev (rows whose loader or adapter column differ):"
  diff <(grep -oE '^[^|]+\| http=200 .*loader=[0-9]+ \| webmcp=[^ ]+' "$prev") <(grep -oE '^[^|]+\| http=200 .*loader=[0-9]+ \| webmcp=[^ ]+' "$out") | grep '^[<>]' || echo "  none"
fi
