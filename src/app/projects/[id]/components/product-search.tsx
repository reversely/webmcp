"use client";
import { useState } from "react";
import type { Category, Product } from "../../../../domain/types";
import type { ProjectSnapshot } from "../../../../server/state";
import { ProductCard } from "./product-card";
import css from "./stages.module.css";

export const CATEGORIES: { value: Category; label: string }[] = [
  { value: "sofa", label: "Sofa" },
  { value: "coffee_table", label: "Coffee table" },
  { value: "ottoman", label: "Ottoman" },
  { value: "rug", label: "Rug" },
  { value: "side_table", label: "Side table" }
];

type SearchResult = { raw: unknown; normalized: Product | null; seller: { domain: string; name: string } };

/**
 * Live Global Catalog search. "Add to project" posts the raw catalog object with the chosen
 * category, then tells the frame (BOM rail) to refresh.
 */
export function ProductSearch({ projectId, onAdded }: { projectId: string; onAdded?: (snapshot: ProjectSnapshot) => void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("sofa");
  const [maxPrice, setMaxPrice] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());

  async function search() {
    const label = CATEGORIES.find((c) => c.value === category)!.label.toLowerCase();
    const q = query.trim() ? query.trim() : label;
    setSearching(true);
    setError(null);
    try {
      const res = await fetch("/api/shopify/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, limit: 24, ...(maxPrice ? { max_cents: Math.round(Number(maxPrice) * 100) } : {}) })
      });
      const body = (await res.json()) as { products?: SearchResult[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? `Search failed (${res.status})`);
      setResults(body.products ?? []);
    } catch (e) {
      setError((e as Error).message);
      setResults(null);
    } finally {
      setSearching(false);
    }
  }

  async function add(r: SearchResult) {
    const key = r.normalized?.id ?? JSON.stringify(r.raw).slice(0, 80);
    setAdding(key);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ catalog: r.raw, category })
      });
      const body = (await res.json()) as ProjectSnapshot & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Add failed (${res.status})`);
      setAdded((prev) => new Set(prev).add(key));
      window.dispatchEvent(new Event("project:changed"));
      onAdded?.(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAdding(null);
    }
  }

  return (
    <section className="surface" aria-label="Source products">
      <div className="eyebrow">Source products</div>
      <h2 className="surface-title">Search the catalog</h2>
      <form
        className={css.stack}
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <div className="field">
          <label htmlFor="search-q">Search</label>
          <input id="search-q" className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. walnut coffee table" />
        </div>
        <div className={css.row}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="search-cat">Category</label>
            <select id="search-cat" className="select" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ width: 120 }}>
            <label htmlFor="search-max">Max price (USD)</label>
            <input id="search-max" className="input" type="number" min={0} inputMode="numeric" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} placeholder="any" />
          </div>
        </div>
        <div>
          <button className="btn" type="submit" disabled={searching}>
            {searching ? "Searching" : "Search"}
          </button>
        </div>
      </form>
      {error && (
        <p className={css.error} role="alert">
          {error}
        </p>
      )}
      {results && results.length === 0 && <div className="empty">No products matched. Try a broader search or raise the price limit.</div>}
      {results && results.length > 0 && (
        <div className={css.results} style={{ marginTop: 16 }}>
          {results.map((r, i) => {
            const key = r.normalized?.id ?? String(i);
            return r.normalized ? <ProductCard key={key} product={r.normalized} seller={r.seller.name} busy={adding === key} added={added.has(key)} onAdd={() => add(r)} /> : null;
          })}
        </div>
      )}
    </section>
  );
}
