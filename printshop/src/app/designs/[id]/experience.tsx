"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { renderProof } from "../../../domain/proof";
import type { Design, Quote, Shop } from "../../../domain/types";
import { money } from "../../format";

type Props = { design: Design; shop: Shop; earliest: string };
type QuoteState = { ok: true; quote: Quote } | { ok: false; reason: string } | null;

/** The API's error is `rule: reason`; the page shows the reason (PRD Section 5). */
const reasonOf = (error: string) => error.slice(error.indexOf(": ") + 2);

async function post<T>(url: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; reason: string }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  return res.ok ? { ok: true, data: data as T } : { ok: false, reason: reasonOf(String(data.error ?? res.statusText)) };
}

export function DesignExperience({ design, shop, earliest }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(design.fields.map((f) => [f.key, ""])));
  const [quantity, setQuantity] = useState(String(design.minimum_quantity));
  const [neededBy, setNeededBy] = useState(earliest);
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState(shop.address.country);
  const [quote, setQuote] = useState<QuoteState>(null);
  const [names, setNames] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [batchError, setBatchError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const preview = useMemo(() => renderProof(design, { recipient_ref: "preview", values }), [design, values]);
  const address = { name: buyerName, line1: "", city: "", region: "", postal_code: postalCode, country };
  const nameKey = design.fields.find((f) => f.kind === "name")?.key ?? "name";
  const lines = names.split("\n").map((l) => l.trim()).filter(Boolean);

  async function askQuote() {
    setBusy(true);
    const r = await post<Quote>("/api/quotes", { design_id: design.id, quantity: Number(quantity), needed_by: neededBy, address });
    setQuote(r.ok ? { ok: true, quote: r.data } : { ok: false, reason: r.reason });
    setBusy(false);
  }

  async function addToBatch() {
    setBusy(true);
    setBatchError(null);
    const units = lines.map((line, i) => ({ recipient_ref: `unit-${i + 1}`, values: { ...values, [nameKey]: line } }));
    const r = await post<{ id: string }>("/api/batches", { design_id: design.id, units, address, needed_by: neededBy, buyer: { name: buyerName, email: buyerEmail, phone: null } });
    if (r.ok) router.push(`/batches/${r.data.id}`);
    else setBatchError(r.reason);
    setBusy(false);
  }

  return (
    <div className="wrap">
      <div>
        <h1 className="title">{design.title}</h1>
        <section className="block" aria-labelledby="d-details">
          <div className="labelrow"><h2 id="d-details">Details</h2></div>
          <div className="list" data-testid="details">
            <div className="row"><span>Format</span><span className="type">{design.format} {design.size}</span></div>
            <div className="row"><span>Paper</span><span className="type">{design.paper}</span></div>
            <div className="row"><span>Print method</span><span className="type">{design.print_method}</span></div>
            <div className="row"><span>Colours</span><span className="type">{design.colours.join(" or ")}</span></div>
            <div className="row"><span>Price</span><span className="type">{design.price_bands.map((b) => `${b.min_quantity} or more at ${money(b.unit_cents, shop.currency)}`).join(" / ")}</span></div>
            <div className="row"><span>Minimum</span><span className="type">{design.minimum_quantity} units</span></div>
            <div className="row"><span>Lead time</span><span className="type">{design.lead_time_business_days} business days</span></div>
          </div>
        </section>

        <section className="block" aria-labelledby="d-fields">
          <div className="labelrow"><h2 id="d-fields">Personalization</h2></div>
          {design.fields.map((f) => (
            <div className="field" key={f.key}>
              <label htmlFor={`f-${f.key}`}>{f.label} up to {f.max_length} characters{f.required ? "" : " if wanted"}</label>
              <input id={`f-${f.key}`} maxLength={f.max_length} required={f.required} value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} data-testid={`field-${f.key}`} />
            </div>
          ))}
        </section>

        <section className="block" aria-labelledby="d-quote">
          <div className="labelrow"><h2 id="d-quote">Quote</h2></div>
          <div className="grid2">
            <div className="field"><label htmlFor="q-quantity">Quantity</label><input id="q-quantity" type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} data-testid="quantity" /></div>
            <div className="field"><label htmlFor="q-needed">Needed by</label><input id="q-needed" type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} data-testid="needed-by" /></div>
            <div className="field"><label htmlFor="q-postal">Postal code</label><input id="q-postal" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} data-testid="postal-code" /></div>
            <div className="field"><label htmlFor="q-country">Country</label><input id="q-country" value={country} onChange={(e) => setCountry(e.target.value)} data-testid="country" /></div>
          </div>
          <button type="button" className="btn primary" onClick={askQuote} disabled={busy} data-testid="quote">Quote</button>
          {quote?.ok && (
            <div className="list" style={{ marginTop: 16 }} data-testid="quote-result">
              <div className="row"><span>Unit price</span><span className="type" data-testid="quote-unit">{money(quote.quote.unit_cents, quote.quote.currency)}</span></div>
              <div className="row"><span>Total with tax</span><span className="type" data-testid="quote-total">{money(quote.quote.total_cents, quote.quote.currency)}</span></div>
              <div className="row"><span>Ready by</span><span className="type" data-testid="quote-ready">{quote.quote.ready_by}</span></div>
            </div>
          )}
          {quote && !quote.ok && <p className="error" role="alert" data-testid="quote-refusal">{quote.reason}</p>}
        </section>

        <section className="block" aria-labelledby="d-batch">
          <div className="labelrow"><h2 id="d-batch">Batch</h2></div>
          <div className="field">
            <label htmlFor="b-names">One name per line</label>
            <textarea id="b-names" rows={6} value={names} onChange={(e) => setNames(e.target.value)} data-testid="names" />
          </div>
          <div className="grid2">
            <div className="field"><label htmlFor="b-name">Buyer name</label><input id="b-name" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} data-testid="buyer-name" /></div>
            <div className="field"><label htmlFor="b-email">Buyer email</label><input id="b-email" type="email" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} data-testid="buyer-email" /></div>
          </div>
          <div className="acts">
            <button type="button" className="btn primary" onClick={addToBatch} disabled={busy || lines.length === 0 || !buyerEmail.trim()} data-testid="add-to-batch">Add to batch</button>
            <span className="hint" data-testid="unit-count">{lines.length} units</span>
          </div>
          {batchError && <p className="error" role="alert" data-testid="batch-error">{batchError}</p>}
        </section>
      </div>
      <aside className="side">
        <div className="dark-card">
          <div className="in">
            <h2>Preview</h2>
            <div className="preview" data-testid="preview" dangerouslySetInnerHTML={{ __html: preview }} />
          </div>
        </div>
      </aside>
    </div>
  );
}
