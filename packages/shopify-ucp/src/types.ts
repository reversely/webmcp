/**
 * Shapes of Shopify catalog MCP responses, read leniently: every field is optional and unknown
 * fields pass, because the Global Catalog and a Storefront Catalog return different subsets.
 */
import { z } from "zod";

export interface ShipsTo {
  country: string;
  region?: string;
  postal_code?: string;
}

/** Buyer signals the catalog uses for localization (`catalog.context` in every tool schema). */
export interface BuyerContext {
  address_country?: string;
  address_region?: string;
  postal_code?: string;
  language?: string;
  currency?: string;
  intent?: string;
}

export interface SearchFilters {
  ships_to?: ShipsTo;
  price?: { min?: number; max?: number };
  available?: boolean;
  categories?: string[];
  condition?: string[];
  [key: string]: unknown;
}

export interface SearchCatalogParams {
  query?: string;
  filters?: SearchFilters;
  context?: BuyerContext;
  pagination?: { cursor?: string; limit?: number };
  like?: unknown[];
}

export interface LookupOptions {
  context?: BuyerContext;
  filters?: SearchFilters;
}

export interface GetProductOptions extends LookupOptions {
  selected?: { name: string; label: string }[];
}

const Money = z.looseObject({ amount: z.number(), currency: z.string() });

const Media = z.looseObject({ type: z.string().optional(), url: z.string().optional(), alt_text: z.string().optional() });

const Seller = z.looseObject({
  id: z.string().optional(),
  name: z.string().optional(),
  url: z.string().optional(),
  domain: z.string().optional()
});

/** The Storefront wraps description as `{html}`, the Global Catalog as `{plain}`. */
const Description = z.union([
  z.string(),
  z.looseObject({ html: z.string().optional(), plain: z.string().optional(), text: z.string().optional() })
]);

export const CatalogVariant = z.looseObject({
  id: z.string(),
  title: z.string().optional(),
  url: z.string().optional(),
  price: Money.optional(),
  availability: z.looseObject({ available: z.boolean().optional() }).optional(),
  media: z.array(Media).optional(),
  seller: Seller.optional(),
  checkout_url: z.string().optional(),
  options: z.array(z.looseObject({ name: z.string(), label: z.string() })).optional()
});
export type CatalogVariant = z.infer<typeof CatalogVariant>;

export const CatalogProduct = z.looseObject({
  id: z.string(),
  title: z.string(),
  description: Description.optional(),
  url: z.string().optional(),
  handle: z.string().optional(),
  metadata: z.looseObject({ tech_specs: z.string().optional() }).optional(),
  media: z.array(Media).optional(),
  variants: z.array(CatalogVariant).optional(),
  price_range: z.looseObject({ min: Money.optional(), max: Money.optional() }).optional()
});
export type CatalogProduct = z.infer<typeof CatalogProduct>;

export const CatalogMessage = z.looseObject({
  type: z.string(),
  code: z.string().optional(),
  content: z.string().optional(),
  severity: z.string().optional()
});
export type CatalogMessage = z.infer<typeof CatalogMessage>;

const Pagination = z.looseObject({
  has_next_page: z.boolean().optional(),
  cursor: z.string().optional(),
  total_count: z.number().optional()
});

const Envelope = { ucp: z.unknown().optional(), messages: z.array(CatalogMessage).default([]) };

export const SearchCatalogResult = z.looseObject({
  ...Envelope,
  products: z.array(CatalogProduct).default([]),
  pagination: Pagination.optional()
});
export type SearchCatalogResult = z.infer<typeof SearchCatalogResult>;

export const LookupCatalogResult = z.looseObject({ ...Envelope, products: z.array(CatalogProduct).default([]) });
export type LookupCatalogResult = z.infer<typeof LookupCatalogResult>;

/** `product` is absent when the id is unknown; the reason sits in `messages`. */
export const GetProductResult = z.looseObject({ ...Envelope, product: CatalogProduct.optional() });
export type GetProductResult = z.infer<typeof GetProductResult>;

export type CatalogErrorKind = "rpc" | "tool" | "http" | "malformed";

/** A failed catalog call, carrying the server's own message. */
export class CatalogError extends Error {
  readonly kind: CatalogErrorKind;
  readonly code: number | string | null;
  readonly data: unknown;

  constructor(kind: CatalogErrorKind, message: string, options: { code?: number | string | null; data?: unknown } = {}) {
    super(message);
    this.name = "CatalogError";
    this.kind = kind;
    this.code = options.code ?? null;
    this.data = options.data;
  }
}
