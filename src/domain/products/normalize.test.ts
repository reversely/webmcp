import { describe, expect, it } from "vitest";
import { Product } from "../types";
import { normalizeCatalogProduct, stripHtml } from "./normalize";

/** Global Catalog `search_catalog` result shape as observed in spikes/storefront-survey/results.md. */
const globalCatalogSofa = {
  id: "gid://shopify/Product/8457432072354",
  title: "Campbell 3 Seater",
  url: "https://daalshome.com/products/campbell-3-seater?variant=1",
  description: { html: "<p>A deep seat.</p><p>Overall 200 x 140 x 95 cm</p>" },
  metadata: {
    tech_specs: "Seating: 3\nMaterial: Boucle\nDimensions: 197 x 134 x 90 cm\nColour: Oat"
  },
  variants: [
    {
      id: "gid://shopify/ProductVariant/1",
      price: { amount: 129900, currency: "USD" },
      availability: { available: false },
      seller: { domain: "daalshome.com" },
      media: [{ url: "https://cdn.shopify.com/s/files/sold-out.jpg" }]
    },
    {
      id: "gid://shopify/ProductVariant/2",
      price: { amount: 139900, currency: "USD" },
      availability: { available: true },
      seller: { domain: "daalshome.com" },
      media: [{ url: "https://cdn.shopify.com/s/files/oat.jpg" }]
    }
  ]
};

const source = { merchant: "daalshome.com", sourceUrl: "https://daalshome.com/products/campbell-3-seater" };

describe("normalizeCatalogProduct", () => {
  it("maps a Global Catalog product onto the Product schema", () => {
    const product = normalizeCatalogProduct(globalCatalogSofa, source);
    expect(Product.safeParse(product).success).toBe(true);
    expect(product).toMatchObject({
      id: "daalshome.com:gid://shopify/Product/8457432072354",
      external_product_id: "gid://shopify/Product/8457432072354",
      title: "Campbell 3 Seater",
      description: "A deep seat.\nOverall 200 x 140 x 95 cm",
      primary_image_url: "https://cdn.shopify.com/s/files/oat.jpg",
      price_cents: 139900,
      currency: "USD",
      availability_json: { available: true },
      glb_url: null,
      model_status: "no_model"
    });
  });

  it("prefers tech_specs over the description for dimensions", () => {
    const product = normalizeCatalogProduct(globalCatalogSofa, source);
    expect(product).toMatchObject({
      width_mm: 1970,
      depth_mm: 1340,
      height_mm: 900,
      spatial_status: "grounded",
      dimension_source: {
        text: "197 x 134 x 90 cm",
        url: "https://daalshome.com/products/campbell-3-seater?variant=1",
        unit: "cm"
      }
    });
  });

  it("falls back to the description when tech_specs carry no dimensions", () => {
    const product = normalizeCatalogProduct(
      { ...globalCatalogSofa, metadata: { tech_specs: "Seating: 3" } },
      source
    );
    expect(product).toMatchObject({ width_mm: 2000, depth_mm: 1400, height_mm: 950, spatial_status: "grounded" });
  });

  it("marks a Storefront Catalog product without dimension text as visual_only", () => {
    const product = normalizeCatalogProduct(
      {
        id: 8457432072354,
        title: "The Sofa",
        description: { html: "<p>Modular &amp; made to last.</p>" },
        variants: [{ price: { amount: 189500, currency: "USD" }, availability: { available: true } }],
        media: [{ url: "https://cdn.shopify.com/s/files/the-sofa.jpg" }]
      },
      { merchant: "floydhome.com", sourceUrl: "https://floydhome.com/products/the-sofa" }
    );
    expect(product).toMatchObject({
      external_product_id: "8457432072354",
      description: "Modular & made to last.",
      primary_image_url: "https://cdn.shopify.com/s/files/the-sofa.jpg",
      width_mm: null,
      depth_mm: null,
      height_mm: null,
      dimension_source: null,
      spatial_status: "visual_only"
    });
  });

  it("uses the URL handle as the external id when the catalog object has none", () => {
    const product = normalizeCatalogProduct({ title: "Rug", description: "8' x 10'" }, source);
    expect(product.external_product_id).toBe("campbell-3-seater");
    expect(product.price_cents).toBe(0);
  });
});

describe("stripHtml", () => {
  it("keeps block boundaries as newlines and decodes entities", () => {
    expect(stripHtml('<ul><li>Width: 84&quot;</li><li>Depth: 36&#34;</li></ul><br>Height:&nbsp;33&#x22;')).toBe(
      'Width: 84"\nDepth: 36"\nHeight: 33"'
    );
  });
});

describe("Global Catalog description shape", () => {
  it("reads a {plain} description as the Global endpoint returns it", () => {
    const raw = {
      id: "gid://shopify/p/abc",
      title: "Campbell 3 Seater Sofa",
      description: { plain: "A three seater.\nDimensions: 197 x 134 x 90 cm" },
      variants: [{ id: "gid://shopify/ProductVariant/1", price: { amount: 37499, currency: "USD" }, availability: { available: true } }]
    };
    const product = normalizeCatalogProduct(raw, { merchant: "daalshome.myshopify.com", sourceUrl: "https://daalshome.myshopify.com/products/campbell" });
    expect(product.description).toContain("A three seater.");
    expect(product.width_mm).toBe(1970);
    expect(product.spatial_status).toBe("grounded");
  });
});
