#!/bin/bash
# Probe candidate furniture storefronts for Shopify + WebMCP signals.
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/128 Safari/537.36"
for d in "$@"; do
  html=$(curl -sL -A "$UA" --max-time 20 "https://$d/" )
  shopify=$(echo "$html" | grep -c "cdn.shopify.com")
  webmcp=$(echo "$html" | grep -oE "storefront/webmcp/webmcp-[0-9.]+\.js" | head -1)
  token=$(echo "$html" | grep -oE '"storefrontAccessToken":"[a-f0-9]+"|X-Shopify-Storefront-Access-Token[^,]{0,60}' | head -1 | cut -c1-60)
  pj=$(curl -sL -A "$UA" --max-time 20 "https://$d/products.json?limit=1" | head -c 400)
  pjok=$(echo "$pj" | grep -c '"products"')
  ucp=$(curl -s -o /dev/null -w "%{http_code}" -A "$UA" --max-time 15 -X POST "https://$d/api/ucp/mcp" -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
  echo "$d | shopify=$shopify | webmcp=${webmcp:-none} | products.json=$pjok | ucp_mcp=$ucp | token=${token:-none}"
done
