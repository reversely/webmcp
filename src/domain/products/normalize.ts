/**
 * Maps a Shopify catalog product (Global Catalog or Storefront Catalog shape) onto the `Product`
 * schema. The catalog object is read leniently: every field is optional and unknown fields pass.
 */
import { z } from "zod";
import { Product } from "../types";
import { parseDimensions } from "./dimensions";
import { extractHandle } from "./url";

export interface ProductSource {
  merchant: string;
  sourceUrl: string;
}

/** Currency assumed when neither a variant price nor the product carries one. */
export const DEFAULT_CURRENCY = "USD";

const Media = z.looseObject({ url: z.string().optional(), src: z.string().optional() });

const CatalogVariant = z.looseObject({
  id: z.union([z.string(), z.number()]).optional(),
  price: z.looseObject({ amount: z.union([z.number(), z.string()]).optional(), currency: z.string().optional() }).optional(),
  availability: z.looseObject({ available: z.boolean().optional() }).optional(),
  seller: z.looseObject({ domain: z.string().optional() }).optional(),
  media: z.array(Media).optional()
});

const CatalogProduct = z.looseObject({
  id: z.union([z.string(), z.number()]).optional(),
  title: z.string().optional(),
  name: z.string().optional(),
  url: z.string().optional(),
  description: z.union([z.string(), z.looseObject({ html: z.string().optional(), text: z.string().optional(), plain: z.string().optional() })]).optional(),
  media: z.array(Media).optional(),
  images: z.array(Media).optional(),
  metadata: z.looseObject({ tech_specs: z.string().optional() }).optional(),
  variants: z.array(CatalogVariant).optional()
});

type CatalogProduct = z.infer<typeof CatalogProduct>;

export function normalizeCatalogProduct(raw: unknown, source: ProductSource): Product {
  const catalog = CatalogProduct.parse(raw);
  const variants = catalog.variants ?? [];
  // Price and availability describe one purchasable variant: the first in stock, else the first listed.
  const variant = variants.find((candidate) => candidate.availability?.available) ?? variants[0] ?? null;
  const description = descriptionText(catalog.description);
  const productUrl = catalog.url ?? source.sourceUrl;
  const dimensions = parseDimensions(catalog.metadata?.tech_specs ?? "") ?? parseDimensions(description);
  const externalId = externalProductId(catalog, source.sourceUrl);

  return Product.parse({
    id: `${source.merchant}:${externalId}`,
    merchant: source.merchant,
    source_url: source.sourceUrl,
    external_product_id: externalId,
    title: catalog.title ?? catalog.name ?? "",
    description,
    primary_image_url: primaryImageUrl(catalog, variant),
    price_cents: Math.round(Number(variant?.price?.amount ?? 0)),
    currency: variant?.price?.currency ?? DEFAULT_CURRENCY,
    width_mm: dimensions?.width_mm ?? null,
    depth_mm: dimensions?.depth_mm ?? null,
    height_mm: dimensions?.height_mm ?? null,
    dimension_source: dimensions ? { text: dimensions.matchedText, url: productUrl, unit: dimensions.unit } : null,
    spatial_status: dimensions ? "grounded" : "visual_only",
    variant_json: variant,
    availability_json: variant?.availability ?? null,
    glb_url: null,
    model_status: "no_model"
  });
}

function externalProductId(catalog: CatalogProduct, sourceUrl: string): string {
  if (catalog.id !== undefined) return String(catalog.id);
  return extractHandle(catalog.url ?? sourceUrl) ?? sourceUrl;
}

function primaryImageUrl(catalog: CatalogProduct, variant: z.infer<typeof CatalogVariant> | null): string | null {
  const media = [...(variant?.media ?? []), ...(catalog.media ?? []), ...(catalog.images ?? [])];
  return media.map((item) => item.url ?? item.src).find((url) => url) ?? null;
}

function descriptionText(description: CatalogProduct["description"]): string {
  if (!description) return "";
  if (typeof description === "string") return stripHtml(description);
  return description.text ?? description.plain ?? stripHtml(description.html ?? "");
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " "
};

/** Drops tags, keeping block boundaries as newlines so per-line dimension labels stay separable. */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>|<\/(?:p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => decodeEntity(code) ?? entity)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function decodeEntity(code: string): string | null {
  if (code.startsWith("#x") || code.startsWith("#X")) return String.fromCodePoint(parseInt(code.slice(2), 16));
  if (code.startsWith("#")) return String.fromCodePoint(parseInt(code.slice(1), 10));
  return ENTITIES[code.toLowerCase()] ?? null;
}
