#!/bin/bash
# Probe candidate furniture storefronts for Shopify + WebMCP signals.
# Shopify's edge answers 429 to a burst of storefront GETs from one IP (about 300 fetches in a few
# minutes on 2026-08-27 tripped it for every shop at once), so the row carries the homepage HTTP
# status and a non-200 row says nothing about the loader.
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/128 Safari/537.36"
for d in "$@"; do
  html=$(curl -sL -A "$UA" --max-time 20 -w '\n%{http_code}' "https://$d/")
  http=$(echo "$html" | tail -1)
  html=$(echo "$html" | sed '$d')
  shopify=$(echo "$html" | grep -c "cdn.shopify.com")
  webmcp=$(echo "$html" | grep -oE "storefront/webmcp/webmcp-[0-9.]+\.js" | head -1)
  # The CDN URL only appears after the inline loader feature-detects WebMCP in a browser; the
  # loader's localStorage key is the server-side marker for a Liquid storefront (results.md step 9).
  loader=$(echo "$html" | grep -c "shopify:webmcp_adapter_loaded")
  # Liquid storefronts carry the public Storefront token as `accessToken` in <script id="shopify-features">.
  token=$(echo "$html" | grep -oE '"(storefrontAccessToken|accessToken)":"[a-f0-9]{32}"|X-Shopify-Storefront-Access-Token[^,]{0,60}' | head -1 | sed -E 's/"([a-f0-9]{4})[a-f0-9]{28}"/"\1…"/' | cut -c1-60)
  pj=$(curl -sL -A "$UA" --max-time 20 "https://$d/products.json?limit=1" | head -c 400)
  pjok=$(echo "$pj" | grep -c '"products"')
  ucp=$(curl -s -o /dev/null -w "%{http_code}" -A "$UA" --max-time 15 -X POST "https://$d/api/ucp/mcp" -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
  echo "$d | http=$http | shopify=$shopify | loader=$loader | webmcp=${webmcp:-none} | products.json=$pjok | ucp_mcp=$ucp | token=${token:-none}"
  sleep "${DELAY:-1}"
done
