/** Shopify product URL canonicalization. */

const PRODUCT_PATH_RE = /\/products\/([^/?#]+)/i;

/** Returns the product handle from a Shopify product URL, or null when the path has none. */
export function extractHandle(url: string): string | null {
  const match = url.match(PRODUCT_PATH_RE);
  return match ? decodeURIComponent(match[1]).replace(/\.json$/i, "").toLowerCase() : null;
}

/**
 * Reduces a Shopify product URL to `https://{host}/products/{handle}`: query and fragment go
 * (variant selection and utm tags live there), a collection prefix goes, the host lowercases.
 * Returns null when the URL does not parse or has no product handle.
 */
export function normalizeProductUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  const handle = extractHandle(parsed.pathname);
  if (!handle) return null;
  return `https://${parsed.hostname.toLowerCase()}/products/${handle}`;
}
