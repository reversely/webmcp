"use client";
import type { Product } from "../../../../domain/types";
import { formatFeetInches } from "../../../../domain/types";

export const dollars = (cents: number, currency = "USD") => `${currency === "USD" ? "$" : `${currency} `}${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/** Width × depth × height in feet and inches, or null when the product has no parsed dimensions. */
export function dimensionText(p: Pick<Product, "width_mm" | "depth_mm" | "height_mm" | "spatial_status">): string | null {
  if (p.spatial_status !== "grounded" || p.width_mm == null || p.depth_mm == null) return null;
  const parts = [formatFeetInches(p.width_mm), formatFeetInches(p.depth_mm)];
  if (p.height_mm != null) parts.push(formatFeetInches(p.height_mm));
  return parts.join(" × ");
}

/** Search result card: image, title, seller, price, dimensions, and the one add action. */
export function ProductCard({ product, seller, busy, added, onAdd }: { product: Product; seller: string; busy: boolean; added: boolean; onAdd: () => void }) {
  const dims = dimensionText(product);
  return (
    <div className="card">
      {product.primary_image_url ? <img src={product.primary_image_url} alt="" loading="lazy" /> : <div style={{ aspectRatio: "1", background: "var(--paper)", borderRadius: 8 }} />}
      <div className="name">{product.title || "Untitled product"}</div>
      <div className="meta">
        <span>{seller}</span>
        <span>{dollars(product.price_cents, product.currency)}</span>
      </div>
      <div className="meta">{dims ? <span>{dims}</span> : <span className="tag yellow">dimensions unknown</span>}</div>
      <button className="btn" type="button" disabled={busy || added} onClick={onAdd}>
        {added ? "Added" : busy ? "Adding" : "Add to project"}
      </button>
    </div>
  );
}
