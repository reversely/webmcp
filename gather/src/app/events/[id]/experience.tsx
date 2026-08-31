"use client";
import { useMemo, useState } from "react";
import type { Snapshot } from "./dashboard";
import type { Scored } from "../../../agent/search";
import cards from "../../../agent/cards.json";
import type { AttributeDefinition, Batch, GuestStatus } from "../../../domain/types";
import { dateOnly, dateTime, money } from "../../../lib/format";
import { deliveryTarget } from "../../../lib/delivery";
import type { VendorUpdate } from "../../../domain/types";
import type { CurationProposal } from "../../../agent/curation-agent";

type Step = "pick" | "results" | "recipients" | "mapping" | "list";
/** What the curate endpoint returns (#120); the stream wraps it as { kind: "done", ...reply }. */
type CurateReply = { response: string; proposal?: CurationProposal; tool_calls: { tool: string; label: string }[] };
type CurateLine = { kind: "tool"; label: string } | { kind: "error"; error: string } | ({ kind: "done" } & CurateReply);
export type SearchReply = { funnel?: { searches: { query: string; categories?: string[]; returned: number; total: number | null }[]; merged: number; probed: number; ranked: number; excluded: Record<string, number> }; searches: { query: string; categories?: string[] }[]; found: number; probed: number; ranked: Scored[]; excluded: { product_id: string; title: string; shop_name: string; rule: string | null; reason: string | null }[]; duration_ms: number };
type Recipients = "going" | "going_maybe" | "everyone";
const RECIPIENT_FILTERS: Record<Recipients, { field: string; op: string; value?: unknown }[]> = { going: [{ field: "status", op: "eq", value: "going" }], going_maybe: [{ field: "status", op: "in", value: ["going", "maybe"] }], everyone: [] };
const RECIPIENT_LABEL: Record<Recipients, string> = { going: "Guests going", going_maybe: "Going and maybe", everyone: "Everyone invited" };
const STATUS_LABEL: Record<GuestStatus, string> = { going: "Going", maybe: "Maybe", cant_go: "Can't go", no_reply: "No reply" };

type GiftWithQuantities = Snapshot["gifts"][number];

/** A mapping row's source in plain words for the proposal card. */
function sourceLabel(m: CurationProposal["personalization_mapping"][number], definitions: AttributeDefinition[]): string {
  const source = m.source;
  const base =
    source.type === "definition"
      ? `From ${definitions.find((d) => d.id === source.definition_id)?.label ?? source.definition_id}`
      : source.type === "event"
        ? (source.key === "starts_at" ? "From the event date" : source.key === "venue" ? "From the venue" : "From the event title")
        : `Fixed value ${String(source.value)}`;
  return m.transform ? `${base} via ${m.transform.replace(/_/g, " ")}` : base;
}

/** The vendor field's label from the proposed product's schema. */
function fieldLabel(key: string, proposal: CurationProposal): string {
  return proposal.product.personalization?.fields.find((f) => f.key === key)?.label ?? key;
}

/** The variant whose title contains the option's label, case-insensitively; the organizer corrects it on the screen. */
function proposeVariant(label: string, variants: Scored["variants"]): string | null {
  const hit = variants.find((v) => v.title.toLowerCase().includes(label.toLowerCase()));
  return hit?.id ?? null;
}

export function Experience({ snap, onChanged, lastSearch, setLastSearch }: { snap: Snapshot; onChanged: () => void; lastSearch: SearchReply | null; setLastSearch: (r: SearchReply | null) => void }) {
  const gifts = snap.gifts as GiftWithQuantities[];
  const [step, setStep] = useState<Step>(gifts.length ? "list" : "pick");
  const [sentence, setSentence] = useState("");
  const [searchedFor, setSearchedFor] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reply = lastSearch;
  const setReply = setLastSearch;
  const [shown, setShown] = useState(5);
  const [chosen, setChosen] = useState<Scored | null>(null);
  const [recipients, setRecipients] = useState<Recipients>("going");
  const [editing, setEditing] = useState<Batch | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [defaultVariant, setDefaultVariant] = useState<string | null>(null);
  const [fallback, setFallback] = useState<Batch["missing_value_fallback"]>("default");
  const [postLock, setPostLock] = useState<Batch["post_lock_cancellation"]>("keep");
  const [question, setQuestion] = useState("");
  const [thread, setThread] = useState<{ giftId: string; updates: VendorUpdate[] } | null>(null);
  const [replyText, setReplyText] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [curateMessage, setCurateMessage] = useState("");
  const [curating, setCurating] = useState<string | null>(null);
  const [curation, setCuration] = useState<CurateReply | null>(null);
  const [curateError, setCurateError] = useState<string | null>(null);

  const choiceQuestions = useMemo(() => snap.definitions.filter((d) => d.scope === "guest" && (d.value_type === "enum" || d.value_type === "multi_enum") && (d.constraints.options?.length ?? 0) > 0), [snap.definitions]);
  const counts = { going: snap.counts.going, going_maybe: snap.counts.going + snap.counts.maybe, everyone: snap.guests.length };
  const target = deliveryTarget(snap.event);
  const [neededBy, setNeededBy] = useState("");
  async function saveNeededBy() {
    if (!neededBy) return;
    const res = await fetch(`/api/events/${snap.event.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ delivery: { ...(snap.event.delivery ?? { destination: "venue", address: null }), needed_by: neededBy } }) });
    if (res.ok) onChanged();
  }

  const [searching, setSearching] = useState(false);
  async function search(body: { card?: string; sentence?: string }) {
    setSearchedFor(body.card ? (cards.cards.find((c) => c.key === body.card)?.label ?? body.card) : (body.sentence ?? ""));
    setSearching(true);
    setStep("results");
    setError(null);
    try {
      const res = await fetch(`/api/events/${snap.event.id}/search`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(((await res.json()) as { error: string }).error);
      setReply((await res.json()) as SearchReply);
      setShown(5);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("pick");
    } finally {
      setSearching(false);
    }
  }

  function pick(product: Scored) {
    setChosen(product);
    const proposed: Record<string, string | null> = {};
    for (const q of choiceQuestions) for (const o of q.constraints.options ?? []) proposed[`${q.id}|${o.value}`] = proposeVariant(o.label, product.variants);
    setMapping(proposed);
    setDefaultVariant(product.variants.find((v) => v.available)?.id ?? product.variants[0]?.id ?? null);
    setStep("recipients");
  }

  function beginEdit(gift: Batch) {
    setEditing(gift);
    const proposed: Record<string, string | null> = {};
    for (const row of gift.mapping) proposed[`${row.definition_id}|${row.value}`] = row.variant_id;
    setMapping(proposed);
    setDefaultVariant(gift.default_variant_id);
    setFallback(gift.missing_value_fallback);
    setPostLock(gift.post_lock_cancellation);
    setRecipients(gift.recipients.length === 0 ? "everyone" : gift.recipients.some((c) => c.op === "in") ? "going_maybe" : "going");
    setStep("mapping");
  }

  async function confirm() {
    setBusy("Saving the gift");
    setError(null);
    try {
      const source = editing ?? chosen;
      if (!source) throw new Error("No product chosen");
      const variants = editing ? editing.variants : chosen!.variants.map((v) => ({ id: v.id, title: v.title, price_cents: v.price_cents, currency: v.currency }));
      const rows = Object.entries(mapping).filter(([, variantId]) => variantId).map(([key, variantId]) => { const [definition_id, value] = key.split("|"); return { definition_id, value, variant_id: variantId! }; });
      const recipientsFilter = RECIPIENT_FILTERS[recipients];
      const body = { product_id: editing ? editing.product_id : chosen!.product_id, shop_domain: editing ? editing.shop_domain : chosen!.shop_domain, product_title: editing ? editing.product_title : chosen!.title, recipients: recipientsFilter, rules: [{ filter: recipientsFilter, product_id: editing ? editing.product_id : chosen!.product_id }], mapping: rows, default_variant_id: defaultVariant, variants, missing_value_fallback: fallback, post_lock_cancellation: postLock, delivery_window: editing ? (editing.delivery_window ?? null) : (chosen!.delivery?.window ?? null), personalization: editing ? (editing.personalization ?? null) : (chosen!.personalization ?? null) };
      const res = await fetch(editing ? `/api/events/${snap.event.id}/gifts/${editing.id}` : `/api/events/${snap.event.id}/gifts`, { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(((await res.json()) as { error: string }).error);
      setEditing(null);
      setChosen(null);
      setStep("list");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function act(gift: Batch, action: "send" | "approve" | "remove") {
    setBusy(action === "remove" ? "Removing the gift" : action === "send" ? "Pricing the cart at the shop" : "Approving");
    setError(null);
    try {
      const res = await fetch(action === "remove" ? `/api/events/${snap.event.id}/gifts/${gift.id}` : `/api/events/${snap.event.id}/gifts/${gift.id}/${action}`, { method: action === "remove" ? "DELETE" : "POST" });
      if (!res.ok) throw new Error(((await res.json()) as { error: string }).error);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function openThread(gift: Batch) {
    const res = await fetch(`/api/events/${snap.event.id}/gifts/${gift.id}/updates`, { cache: "no-store" });
    if (res.ok) setThread({ giftId: gift.id, updates: ((await res.json()) as { updates: VendorUpdate[] }).updates });
  }
  async function sendReply() {
    if (!thread || !replyText.trim()) return;
    const res = await fetch(`/api/events/${snap.event.id}/gifts/${thread.giftId}/updates`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "reply", text: replyText.trim(), caller: "organizer" }) });
    if (res.ok) {
      setReplyText("");
      await openThread(gifts.find((g) => g.id === thread.giftId)!);
      onChanged();
    }
  }
  const KIND_LABEL: Record<VendorUpdate["kind"], string> = { confirmed: "Confirmed", in_production: "In production", shipped: "Shipped", delivered: "Delivered", issue: "Issue", question: "Question", proof: "Proof", reply: "You" };

  /** Answers from the stage outputs (PRD Section 10, assistant behaviour): why a product is missing, what locks first, who is missing a value. */
  function ask() {
    const q = question.toLowerCase();
    if (!q.trim()) return;
    if (/why|missing|not (in|on) the list|excluded/.test(q) && reply) {
      const named = reply.excluded.find((e) => q.includes(e.title.toLowerCase().slice(0, 12)));
      setAnswer(named ? `${named.title} from ${named.shop_name} excluded by the ${named.rule} rule` : reply.excluded.length ? `${reply.excluded.length} excluded: ${reply.excluded.slice(0, 5).map((e) => `${e.title} by ${e.rule}`).join(" / ")}` : "Nothing excluded in this search");
    } else if (/lock|cutoff|deadline/.test(q)) {
      const dated = gifts.filter((g) => g.cutoff).sort((a, b) => (a.cutoff! < b.cutoff! ? -1 : 1));
      setAnswer(dated.length ? `${dated[0].product_title} locks first on ${dateOnly(dated[0].cutoff)}` : "No lock date before approval");
    } else if (/name|value|answer/.test(q)) {
      const missing = snap.follow_ups.filter((f) => f.kind === "missing_value");
      setAnswer(missing.length ? missing.map((f) => `${f.guest_ids.length} without ${snap.definitions.find((d) => d.id === f.definition_id)?.label.toLowerCase()}`).join(" / ") : "Every required answer given");
    } else if (/how many|count|quantit/.test(q)) {
      setAnswer(gifts.length ? gifts.map((g) => { const n = g.quantities.reduce((s, x) => s + x.quantity, 0); return `${g.product_title} ${n} ${n === 1 ? "unit" : "units"}`; }).join(" / ") : `${counts.going} going and no gift yet`);
    } else {
      setAnswer("Ask why a product is missing or which gift locks first or who is missing a value or how many units");
    }
  }

  /** One curation turn over the streaming endpoint; each tool line names the running activity. */
  async function curate() {
    const message = curateMessage.trim();
    if (!message) return;
    setCurating("Sending the request");
    setCurateError(null);
    setCuration(null);
    try {
      const res = await fetch(`/api/events/${snap.event.id}/curate?stream=1`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) });
      if (!res.ok) throw new Error(((await res.json()) as { error: string }).error);
      if (!res.body) throw new Error("The run returned nothing");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const raw of lines) {
          if (!raw.trim()) continue;
          const line = JSON.parse(raw) as CurateLine;
          if (line.kind === "tool") setCurating(line.label);
          else if (line.kind === "error") throw new Error(line.error);
          else {
            setCuration({ response: line.response, proposal: line.proposal, tool_calls: line.tool_calls });
            onChanged();
          }
        }
      }
    } catch (e) {
      setCurateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCurating(null);
    }
  }

  /** The run already created the gift and stored the mappings; approval continues into the existing gift flow. */
  function approveCuration() {
    setCuration(null);
    setCurateMessage("");
    setStep("list");
    onChanged();
  }

  const curateBlock = (
    <section className="block" aria-labelledby="gx-curate" style={{ marginTop: 40 }}>
      <div className="labelrow"><h2 id="gx-curate" style={{ fontSize: 22 }}>Curated experience</h2></div>
      <div className="ask" style={{ marginBottom: 16 }}>
        <input aria-label="Describe the curated experience" placeholder="Describe the curated experience" value={curateMessage} onChange={(e) => setCurateMessage(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !curating && curate()} data-testid="curate" />
        <button type="button" className="btn primary small" onClick={curate} disabled={!!curating || !curateMessage.trim()} data-testid="curate-run">Curate</button>
      </div>
      {curating && <p className="hint" style={{ color: "var(--muted)" }} data-testid="curate-busy">{curating}</p>}
      {curateError && <p className="error" role="alert" data-testid="curate-error">{curateError}</p>}
      {curation && (
        <div>
          <p className="lead" style={{ marginBottom: 16 }} data-testid="curate-response">{curation.response}</p>
          {curation.proposal && (
            <>
              <div className="list" style={{ marginBottom: 16 }} data-testid="curate-proposal">
                <div className="row" style={{ gridTemplateColumns: "1fr auto" }}>
                  <span style={{ fontWeight: 600 }}>{curation.proposal.product.title}</span>
                  <span className="type">{curation.proposal.product.shop_name}{curation.proposal.product.price_cents !== null ? ` / ${money(curation.proposal.product.price_cents, curation.proposal.product.currency ?? "CAD")}` : ""}</span>
                </div>
                {curation.proposal.personalization_mapping.map((m) => (
                  <div className="row" key={m.vendor_field_key} style={{ gridTemplateColumns: "1fr auto" }} data-testid="curate-mapping">
                    <span>{fieldLabel(m.vendor_field_key, curation.proposal!)}</span>
                    <span className="type">{sourceLabel(m, snap.definitions)}</span>
                  </div>
                ))}
                <div className="row" style={{ gridTemplateColumns: "1fr auto" }} data-testid="curate-coverage">
                  <span>Coverage</span>
                  <span className="type">{curation.proposal.manifest_summary.ready} ready / {curation.proposal.manifest_summary.incomplete} incomplete / {curation.proposal.manifest_summary.excluded} excluded</span>
                </div>
                {curation.proposal.issues.map((issue, i) => (
                  <div className="row" key={`${issue.vendor_field_key}-${i}`} style={{ gridTemplateColumns: "1fr auto" }} data-testid="curate-issue">
                    <span>{issue.message}</span>
                    <span className="type">{fieldLabel(issue.vendor_field_key, curation.proposal!)}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button type="button" className="btn primary" onClick={approveCuration} data-testid="curate-approve">Approve and continue</button>
                <button type="button" className="btn ghost" onClick={() => setCuration(null)} data-testid="curate-revise">Revise the request</button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );

  const summaryUnits = gifts.reduce((s, g) => s + g.quantities.reduce((t, x) => t + x.quantity, 0), 0);
  const summaryCard = (
    <aside className="side">
      <div className="eyebrow" style={{ marginBottom: 12 }}>Order summary</div>
      <div className="dark-card" data-testid="order-summary">
        <div className="in">
          <h2>{summaryUnits} {summaryUnits === 1 ? "gift" : "gifts"}</h2>
          <div className="when">Quantities follow the replies until the lock date</div>
          {gifts.map((g) => (
            <div key={g.id}>
              <div className="kv"><span>{g.product_title}</span><span>{g.shop_domain}</span></div>
              {g.quantities.map((q) => {
                const v = g.variants.find((x) => x.id === q.variant_id);
                return <div className="kv" key={`${q.product_id}-${q.variant_id}`}><span style={{ paddingLeft: 12 }}>{v?.title ?? "Variant"}</span><span>{q.quantity}{v?.price_cents !== null && v?.price_cents !== undefined ? ` for ${money(v.price_cents * q.quantity, v.currency ?? "CAD")}` : ""}</span></div>;
              })}
              <div className="kv"><span style={{ paddingLeft: 12 }}>Locks</span><span>{g.cutoff ? dateOnly(g.cutoff) : "after approval"}</span></div>
            </div>
          ))}
          <div className="note">Priced on send and kept after approval</div>
        </div>
      </div>
    </aside>
  );

  return (
    <div className="wrap">
      <div>
        {step !== "list" && (
          <div className="progress" aria-hidden="true">{(["pick", "results", "recipients", "mapping"] as Step[]).map((s, i) => <span key={s} className={["pick", "results", "recipients", "mapping"].indexOf(step) >= i ? "on" : ""} />)}</div>
        )}

        {step === "pick" && (
          <section aria-labelledby="gx-pick">
            <h1 className="title" id="gx-pick">Gifts</h1>
            {target.needed_by ? (
              <p className="lead">Delivery to {target.label} by {dateOnly(target.needed_by)} checked before anything is shown</p>
            ) : (
              <div className="field" style={{ maxWidth: 420 }} data-testid="needed-by-ask">
                <label htmlFor="gx-needed">Gifts needed at {target.label} by</label>
                <div className="row" style={{ gridTemplateColumns: "1fr auto", padding: 0, border: 0 }}>
                  <input id="gx-needed" type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
                  <button type="button" className="btn primary small" onClick={saveNeededBy} disabled={!neededBy}>Set</button>
                </div>
              </div>
            )}
            <div className="cats" data-testid="cards">
              {cards.cards.map((c) => (
                <button key={c.key} type="button" className="cat" onClick={() => search({ card: c.key })} disabled={!!busy || !target.needed_by} data-testid={`card-${c.key}`}>
                  <span className="ph" />
                  <span>{c.label}</span>
                </button>
              ))}
            </div>
            <div className="ask" style={{ marginBottom: 24 }}>
              <input aria-label="Describe the gift" placeholder="Or describe it" value={sentence} onChange={(e) => setSentence(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sentence.trim() && search({ sentence })} data-testid="sentence" />
              <button type="button" className="btn primary small" onClick={() => sentence.trim() && search({ sentence })} disabled={!!busy || !sentence.trim() || !target.needed_by}>Search</button>
            </div>
            {curateBlock}
            {gifts.length > 0 && <button type="button" className="btn ghost" onClick={() => setStep("list")}>Back to the gifts</button>}
          </section>
        )}

        {step === "results" && searching && (
          <section aria-labelledby="gx-results" aria-busy="true" data-testid="results-skeleton">
            <h1 className="title" id="gx-results">Results for {searchedFor}</h1>
            <p className="lead">Searching the catalog and checking delivery</p>
            <div className="list" style={{ marginBottom: 24 }}>
              {[0, 1, 2, 3, 4].map((i) => <div className="row" key={i} style={{ gridTemplateColumns: "1fr auto" }}><span className="skel-line" style={{ width: `${40 + i * 8}%` }} /><span className="skel-line" style={{ width: 90 }} /></div>)}
            </div>
            <div className="results">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div className="prod skel-card" key={i}>
                  <span className="ph" />
                  <span className="body"><span className="skel-line" style={{ width: "80%" }} /><span className="skel-line" style={{ width: "50%" }} /><span className="skel-line" style={{ width: "60%" }} /></span>
                  <span className="act"><span className="skel-line" style={{ width: 48 }} /><span className="skel-line" style={{ width: 64 }} /></span>
                </div>
              ))}
            </div>
          </section>
        )}

        {step === "results" && !searching && reply && (
          <section aria-labelledby="gx-results">
            <h1 className="title" id="gx-results">Results for {searchedFor}</h1>
            <p className="lead">{Math.min(shown, reply.ranked.length)} of {reply.funnel?.ranked ?? reply.ranked.length} shown</p>
            {reply.funnel && (
              <div className="list" style={{ marginBottom: 24 }} data-testid="funnel">
                {reply.funnel.searches.map((s, i) => (
                  <div className="row" key={i} style={{ gridTemplateColumns: "1fr auto" }}><span>"{s.query}"{s.categories?.length ? ` in ${s.categories.join(" and ")}` : ""}</span><span className="type">{s.returned} of {s.total ?? "?"} in the catalog</span></div>
                ))}
                <div className="row" style={{ gridTemplateColumns: "1fr auto" }}><span>Distinct products</span><span className="type">{reply.funnel.merged}</span></div>
                <div className="row" style={{ gridTemplateColumns: "1fr auto" }}><span>Checked for delivery to the venue</span><span className="type">{reply.funnel.probed}</span></div>
                {Object.entries(reply.funnel.excluded).map(([rule, n]) => (
                  <div className="row" key={rule} style={{ gridTemplateColumns: "1fr auto" }}><span>Excluded by {rule.replace(/_/g, " ")}</span><span className="type">{n}</span></div>
                ))}
              </div>
            )}
            <div className="results" data-testid="results">
              {reply.ranked.slice(0, shown).map((p) => (
                <button key={p.product_id} type="button" className="prod" onClick={() => pick(p)} data-testid="result">
                  {p.image_url ? <img className="ph" src={p.image_url} alt="" /> : <span className="ph" />}
                  <span className="body">
                    <span className="name">{p.title}</span>
                    <span className="meta">{p.shop_name}</span>
                    <span className="meta">{p.delivery?.window ? `Arrives by ${dateOnly(p.delivery.window.latest)}` : p.delivery?.text ? p.delivery.text : "Delivery not stated"}</span>
                    {p.option_names.length > 0 && <span className="pers">Choices: {p.option_names.join(", ")}</span>}
                  </span>
                  <span className="act"><span className="price">{p.price_cents !== null ? money(p.price_cents, p.currency ?? "CAD") : ""}</span><span className="add">Choose</span></span>
                </button>
              ))}
              {shown < reply.ranked.length && <button type="button" className="more" onClick={() => setShown(shown + 5)} data-testid="show-more">Show 5 more</button>}
            </div>
            {reply.ranked.length === 0 && <p className="lead">Nothing fits and {reply.excluded.length} excluded</p>}
            <div style={{ display: "flex", gap: 10, marginTop: 24 }}><button type="button" className="btn ghost" onClick={() => setStep("pick")}>Back</button></div>
          </section>
        )}

        {step === "recipients" && chosen && (
          <section aria-labelledby="gx-who">
            <h1 className="title" id="gx-who">Recipients</h1>
            <p className="lead">{chosen.title} from {chosen.shop_name} to {target.label}</p>
            <div className="big" data-testid="recipients">
              {(Object.keys(RECIPIENT_LABEL) as Recipients[]).map((r) => (
                <button key={r} type="button" className={recipients === r ? "on" : ""} aria-pressed={recipients === r} onClick={() => setRecipients(r)}>{RECIPIENT_LABEL[r]} ({counts[r]})</button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10 }}><button type="button" className="btn ghost" onClick={() => setStep("results")}>Back</button><button type="button" className="btn primary" onClick={() => setStep("mapping")} data-testid="next">Next</button></div>
          </section>
        )}

        {step === "mapping" && (chosen || editing) && (
          <section aria-labelledby="gx-map">
            <h1 className="title" id="gx-map">Variants</h1>
            <p className="lead">One variant per answer and a fallback for no answer</p>
            {choiceQuestions.length === 0 && <p className="hint" style={{ color: "var(--muted)" }}>No choice question so every guest takes the default variant</p>}
            {choiceQuestions.map((q) => (
              <div key={q.id} data-testid={`map-${q.key}`}>
                <div className="labelrow"><h2 style={{ fontSize: 18 }}>{q.label}</h2></div>
                {(q.constraints.options ?? []).map((o) => (
                  <div className="line" key={o.value}>
                    <span>{o.label}</span>
                    <select aria-label={`Variant for ${o.label}`} value={mapping[`${q.id}|${o.value}`] ?? ""} onChange={(e) => setMapping({ ...mapping, [`${q.id}|${o.value}`]: e.target.value || null })}>
                      <option value="">Use the default variant</option>
                      {(editing ? editing.variants : chosen!.variants).map((v) => <option key={v.id} value={v.id}>{v.title}{v.price_cents !== null ? ` at ${money(v.price_cents, v.currency ?? "CAD")}` : ""}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            ))}
            <div className="line"><span>Default variant for no answer</span><select aria-label="Default variant" value={defaultVariant ?? ""} onChange={(e) => setDefaultVariant(e.target.value || null)}>{(editing ? editing.variants : chosen!.variants).map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}</select></div>
            <div className="line"><span>Missing required answer</span><select aria-label="Missing answer" value={fallback} onChange={(e) => setFallback(e.target.value as Batch["missing_value_fallback"])}><option value="default">Use the default variant</option><option value="hold">Hold the unit until an answer</option><option value="blank">No unit for them</option></select></div>
            <div className="line"><span>Cancellation after the lock</span><select aria-label="After the lock" value={postLock} onChange={(e) => setPostLock(e.target.value as Batch["post_lock_cancellation"])}><option value="keep">Keep the unit</option><option value="reassign">Offer it to a maybe</option><option value="drop">Drop it where the shop allows</option></select></div>
            <div className="acts"><button type="button" className="btn ghost" onClick={() => (editing ? setStep("list") : setStep("recipients"))}>Back</button><button type="button" className="btn primary" onClick={confirm} disabled={!!busy} data-testid="confirm">{editing ? "Save changes" : "Add this gift"}</button></div>
          </section>
        )}

        {step === "list" && (
          <section aria-labelledby="gx-list">
            <h1 className="title" id="gx-list">Gifts</h1>
            <p className="lead">Quantities follow the replies until the lock date</p>
            <div data-testid="gifts">
              {gifts.map((g) => {
                const units = g.quantities.reduce((s, q) => s + q.quantity, 0);
                const total = g.quantities.reduce((s, q) => { const v = g.variants.find((x) => x.id === q.variant_id); return s + (v?.price_cents ?? 0) * q.quantity; }, 0);
                const currency = g.variants[0]?.currency ?? "CAD";
                return (
                  <div className="item" key={g.id} data-testid="gift">
                    <div>
                      <div style={{ fontWeight: 600 }}>{g.product_title}</div>
                      <div className="m">{[g.shop_domain, `${units} ${units === 1 ? "unit" : "units"}`, money(total, currency), g.cutoff ? `locks ${dateOnly(g.cutoff)}` : "lock date on approval", g.cart_id ? "priced at the shop" : "", g.locked_at ? "locked" : ""].filter(Boolean).join(" / ")}</div>
                      <div className="m">{g.quantities.map((q) => `${g.variants.find((v) => v.id === q.variant_id)?.title ?? "Variant"} ${q.quantity}`).join(" / ") || "no units yet"}</div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button type="button" className="btn ghost small" onClick={() => (thread?.giftId === g.id ? setThread(null) : openThread(g))} data-testid="thread-gift">{thread?.giftId === g.id ? "Hide thread" : "Thread"}</button>
                      <button type="button" className="btn ghost small" onClick={() => beginEdit(g)} data-testid="edit-gift">Edit</button>
                      <button type="button" className="btn ghost small" onClick={() => act(g, "remove")} data-testid="remove-gift">Remove</button>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      {!g.cart_id && <button type="button" className="btn primary small" onClick={() => act(g, "send")} disabled={!!busy || units === 0} data-testid="send-gift">Send to vendor</button>}
                      {g.cart_id && !g.cutoff && <button type="button" className="btn primary small" onClick={() => act(g, "approve")} disabled={!!busy} data-testid="approve-gift">Approve</button>}
                    </div>
                  </div>
                );
              })}
            </div>
            {thread && (
              <div className="list" style={{ marginBottom: 16 }} data-testid="thread">
                {thread.updates.length === 0 && <div className="row" style={{ gridTemplateColumns: "1fr" }}><span className="type">No posts yet</span></div>}
                {thread.updates.map((u) => (
                  <div className="row" key={u.id} style={{ gridTemplateColumns: "auto 1fr auto" }}>
                    <span className={`tag${u.kind === "reply" ? " quiet" : ""}`}>{KIND_LABEL[u.kind]}</span>
                    <span>{[u.text, u.expected_date ? `expected ${dateOnly(u.expected_date)}` : "", u.reference ?? ""].filter(Boolean).join(" / ")}</span>
                    <span className="type">{dateTime(u.created_at)}</span>
                  </div>
                ))}
                <div className="row" style={{ gridTemplateColumns: "1fr auto" }}>
                  <input aria-label="Reply to the vendor" placeholder="Reply to the vendor" value={replyText} onChange={(e) => setReplyText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendReply()} style={{ border: 0, padding: 0, font: "inherit", width: "100%" }} data-testid="reply" />
                  <button type="button" className="btn ghost small" onClick={sendReply} disabled={!replyText.trim()}>Send</button>
                </div>
              </div>
            )}
            <div className="acts">
              <button type="button" className="btn ghost" onClick={() => setStep("pick")} data-testid="add-gift">Add another gift</button>
              <div className="ask" style={{ flex: 1 }}>
                <input aria-label="Ask about the gifts" placeholder="Ask about the gifts" value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} data-testid="ask" />
                <button type="button" className="btn primary small" onClick={ask}>Ask</button>
              </div>
            </div>
            {answer && <p className="lead" style={{ marginTop: 16 }} data-testid="answer">{answer}</p>}
            {curateBlock}
          </section>
        )}

        {busy && <p className="hint" style={{ color: "var(--muted)", marginTop: 16 }} data-testid="busy">{busy}</p>}
        {error && <p className="error" role="alert" data-testid="gx-error">{error}</p>}
      </div>
      {summaryCard}
    </div>
  );
}
