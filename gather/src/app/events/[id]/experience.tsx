"use client";
import { useMemo, useState } from "react";
import type { Snapshot } from "./dashboard";
import type { Scored } from "../../../agent/search";
import cards from "../../../agent/cards.json";
import type { AttributeDefinition, Batch, GuestStatus } from "../../../domain/types";
import { dateOnly, dateTime, money } from "../../../lib/format";
import type { VendorUpdate } from "../../../domain/types";

type Step = "pick" | "results" | "recipients" | "mapping" | "list";
export type SearchReply = { funnel?: { searches: { query: string; categories?: string[]; returned: number; total: number | null }[]; merged: number; probed: number; ranked: number; excluded: Record<string, number> }; searches: { query: string; categories?: string[] }[]; found: number; probed: number; ranked: Scored[]; excluded: { product_id: string; title: string; shop_name: string; rule: string | null; reason: string | null }[]; duration_ms: number };
type Recipients = "going" | "going_maybe" | "everyone";
const RECIPIENT_FILTERS: Record<Recipients, { field: string; op: string; value?: unknown }[]> = { going: [{ field: "status", op: "eq", value: "going" }], going_maybe: [{ field: "status", op: "in", value: ["going", "maybe"] }], everyone: [] };
const RECIPIENT_LABEL: Record<Recipients, string> = { going: "Guests going", going_maybe: "Going and maybe", everyone: "Everyone invited" };
const STATUS_LABEL: Record<GuestStatus, string> = { going: "Going", maybe: "Maybe", cant_go: "Can't go", no_reply: "No reply" };

type GiftWithQuantities = Snapshot["gifts"][number];

/** The variant whose title contains the option's label, case-insensitively; the organizer corrects it on the screen. */
function proposeVariant(label: string, variants: Scored["variants"]): string | null {
  const hit = variants.find((v) => v.title.toLowerCase().includes(label.toLowerCase()));
  return hit?.id ?? null;
}

export function Experience({ snap, onChanged, lastSearch, setLastSearch }: { snap: Snapshot; onChanged: () => void; lastSearch: SearchReply | null; setLastSearch: (r: SearchReply | null) => void }) {
  const gifts = snap.gifts as GiftWithQuantities[];
  const [step, setStep] = useState<Step>(gifts.length ? "list" : "pick");
  const [sentence, setSentence] = useState("");
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

  const choiceQuestions = useMemo(() => snap.definitions.filter((d) => d.scope === "guest" && (d.value_type === "enum" || d.value_type === "multi_enum") && (d.constraints.options?.length ?? 0) > 0), [snap.definitions]);
  const counts = { going: snap.counts.going, going_maybe: snap.counts.going + snap.counts.maybe, everyone: snap.guests.length };
  const eventDate = snap.event.starts_at.slice(0, 10);

  async function search(body: { card?: string; sentence?: string }) {
    setBusy("Searching the catalog, then checking delivery to the venue for the closest matches.");
    setError(null);
    try {
      const res = await fetch(`/api/events/${snap.event.id}/search`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(((await res.json()) as { error: string }).error);
      setReply((await res.json()) as SearchReply);
      setShown(5);
      setStep("results");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
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
    setBusy("Saving the gift.");
    setError(null);
    try {
      const source = editing ?? chosen;
      if (!source) throw new Error("Pick a product first.");
      const variants = editing ? editing.variants : chosen!.variants.map((v) => ({ id: v.id, title: v.title, price_cents: v.price_cents, currency: v.currency }));
      const rows = Object.entries(mapping).filter(([, variantId]) => variantId).map(([key, variantId]) => { const [definition_id, value] = key.split("|"); return { definition_id, value, variant_id: variantId! }; });
      const recipientsFilter = RECIPIENT_FILTERS[recipients];
      const body = { product_id: editing ? editing.product_id : chosen!.product_id, shop_domain: editing ? editing.shop_domain : chosen!.shop_domain, product_title: editing ? editing.product_title : chosen!.title, recipients: recipientsFilter, rules: [{ filter: recipientsFilter, product_id: editing ? editing.product_id : chosen!.product_id }], mapping: rows, default_variant_id: defaultVariant, variants, missing_value_fallback: fallback, post_lock_cancellation: postLock, delivery_window: editing ? (editing.delivery_window ?? null) : (chosen!.delivery?.window ?? null) };
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
    setBusy(action === "remove" ? "Removing the gift." : action === "send" ? "Building the priced proposal at the shop." : "Approving.");
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
      setAnswer(named ? `${named.title} (${named.shop_name}) failed the ${named.rule} rule: ${named.reason}` : reply.excluded.length ? `${reply.excluded.length} products did not fit: ${reply.excluded.slice(0, 5).map((e) => `${e.title} (${e.rule})`).join("; ")}.` : "Nothing was excluded from this search.");
    } else if (/lock|cutoff|deadline/.test(q)) {
      const dated = gifts.filter((g) => g.cutoff).sort((a, b) => (a.cutoff! < b.cutoff! ? -1 : 1));
      setAnswer(dated.length ? `${dated[0].product_title} locks first, on ${dateOnly(dated[0].cutoff)}.` : "No gift has a lock date yet; the date is set when a gift is approved.");
    } else if (/name|value|answer/.test(q)) {
      const missing = snap.follow_ups.filter((f) => f.kind === "missing_value");
      setAnswer(missing.length ? missing.map((f) => `${f.guest_ids.length} missing ${snap.definitions.find((d) => d.id === f.definition_id)?.label.toLowerCase()}`).join("; ") + "." : "Every guest going has answered every required question.");
    } else if (/how many|count|quantit/.test(q)) {
      setAnswer(gifts.length ? gifts.map((g) => `${g.product_title}: ${g.quantities.reduce((s, x) => s + x.quantity, 0)} units`).join("; ") + "." : `${counts.going} guests are going; no gift is chosen yet.`);
    } else {
      setAnswer("This bar answers from the search and the plan: why a product is missing, which gift locks first, who is missing a value, and how many units each gift needs.");
    }
  }

  const summaryCard = (
    <aside className="side">
      <div className="eyebrow" style={{ marginBottom: 12 }}>Order summary</div>
      <div className="dark-card" data-testid="order-summary">
        <div className="in">
          <h2>{gifts.reduce((s, g) => s + g.quantities.reduce((t, x) => t + x.quantity, 0), 0)} gifts</h2>
          <div className="when">Quantities follow the replies until each gift's lock date.</div>
          {gifts.map((g) => (
            <div key={g.id}>
              <div className="kv"><span>{g.product_title}</span><span>{g.shop_domain}</span></div>
              {g.quantities.map((q) => {
                const v = g.variants.find((x) => x.id === q.variant_id);
                return <div className="kv" key={`${q.product_id}-${q.variant_id}`}><span style={{ paddingLeft: 12 }}>{v?.title ?? "Variant"}</span><span>{q.quantity}{v?.price_cents !== null && v?.price_cents !== undefined ? `, ${money(v.price_cents * q.quantity, v.currency ?? "CAD")}` : ""}</span></div>;
              })}
              <div className="kv"><span style={{ paddingLeft: 12 }}>Locks</span><span>{g.cutoff ? dateOnly(g.cutoff) : "after approval"}</span></div>
            </div>
          ))}
          <div className="note">The vendor receives variants and quantities after you approve; a cart is priced on send and kept only once approved.</div>
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
            <h1 className="title" id="gx-pick">A gift for your guests</h1>
            <p className="lead">Pick a category or describe it. Delivery to the venue by {dateOnly(eventDate)} is checked before anything is shown.</p>
            <div className="cats" data-testid="cards">
              {cards.cards.map((c) => (
                <button key={c.key} type="button" className="cat" onClick={() => search({ card: c.key })} disabled={!!busy} data-testid={`card-${c.key}`}>
                  <span className="ph" />
                  <span>{c.label}</span>
                </button>
              ))}
            </div>
            <div className="ask" style={{ marginBottom: 24 }}>
              <input aria-label="Describe the gift" placeholder="Or describe it" value={sentence} onChange={(e) => setSentence(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sentence.trim() && search({ sentence })} data-testid="sentence" />
              <button type="button" className="btn primary small" onClick={() => sentence.trim() && search({ sentence })} disabled={!!busy || !sentence.trim()}>Search</button>
            </div>
            {gifts.length > 0 && <button type="button" className="btn ghost" onClick={() => setStep("list")}>Back to the gifts</button>}
          </section>
        )}

        {step === "results" && reply && (
          <section aria-labelledby="gx-results">
            <h1 className="title" id="gx-results">{reply.funnel?.ranked ?? reply.ranked.length} fit; the best {Math.min(shown, reply.ranked.length)} below</h1>
            <p className="lead">{reply.found} products came back from {reply.searches.length} {reply.searches.length === 1 ? "search" : "searches"}; {reply.probed} were checked for delivery to the venue; {reply.excluded.length} were excluded. Ranked by delivery, price, and what the shop states.</p>
            {reply.funnel && (
              <div className="list" style={{ marginBottom: 24 }} data-testid="funnel">
                {reply.funnel.searches.map((s, i) => (
                  <div className="row" key={i} style={{ gridTemplateColumns: "1fr auto" }}><span>"{s.query}"{s.categories?.length ? ` in ${s.categories.join(", ")}` : ""}</span><span className="type">{s.returned} of {s.total ?? "?"} in the catalog</span></div>
                ))}
                <div className="row" style={{ gridTemplateColumns: "1fr auto" }}><span>Distinct products</span><span className="type">{reply.funnel.merged}</span></div>
                <div className="row" style={{ gridTemplateColumns: "1fr auto" }}><span>Checked for delivery to the venue</span><span className="type">{reply.funnel.probed}</span></div>
                {Object.entries(reply.funnel.excluded).map(([rule, n]) => (
                  <div className="row" key={rule} style={{ gridTemplateColumns: "1fr auto" }}><span>Excluded by the {rule.replace(/_/g, " ")} rule</span><span className="type">{n}</span></div>
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
            {reply.ranked.length === 0 && <p className="lead">Nothing that fits came back. {reply.excluded.length} products were excluded; ask why below, or try another category.</p>}
            <div style={{ display: "flex", gap: 10, marginTop: 24 }}><button type="button" className="btn ghost" onClick={() => setStep("pick")}>Back</button></div>
          </section>
        )}

        {step === "recipients" && chosen && (
          <section aria-labelledby="gx-who">
            <h1 className="title" id="gx-who">Who receives one?</h1>
            <p className="lead">{chosen.title} from {chosen.shop_name}. The quantity follows the replies in this group until the lock date.</p>
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
            <h1 className="title" id="gx-map">How each guest's unit is chosen</h1>
            <p className="lead">Each answer to a choice question maps to one of the shop's variants; a guest with no answer takes the fallback.</p>
            {choiceQuestions.length === 0 && <p className="hint" style={{ color: "var(--muted)" }}>No choice question is on the form, so every guest takes the default variant.</p>}
            {choiceQuestions.map((q) => (
              <div key={q.id} data-testid={`map-${q.key}`}>
                <div className="labelrow"><h2 style={{ fontSize: 18 }}>{q.label}</h2></div>
                {(q.constraints.options ?? []).map((o) => (
                  <div className="line" key={o.value}>
                    <span>{o.label}</span>
                    <select aria-label={`Variant for ${o.label}`} value={mapping[`${q.id}|${o.value}`] ?? ""} onChange={(e) => setMapping({ ...mapping, [`${q.id}|${o.value}`]: e.target.value || null })}>
                      <option value="">Use the default variant</option>
                      {(editing ? editing.variants : chosen!.variants).map((v) => <option key={v.id} value={v.id}>{v.title}{v.price_cents !== null ? `, ${money(v.price_cents, v.currency ?? "CAD")}` : ""}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            ))}
            <div className="line"><span>Default variant, for a guest with no answer</span><select aria-label="Default variant" value={defaultVariant ?? ""} onChange={(e) => setDefaultVariant(e.target.value || null)}>{(editing ? editing.variants : chosen!.variants).map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}</select></div>
            <div className="line"><span>When a required answer is missing</span><select aria-label="Missing answer" value={fallback} onChange={(e) => setFallback(e.target.value as Batch["missing_value_fallback"])}><option value="default">Use the default variant</option><option value="hold">Hold the unit until they answer</option><option value="blank">No unit for them</option></select></div>
            <div className="line"><span>If a guest cancels after the lock</span><select aria-label="After the lock" value={postLock} onChange={(e) => setPostLock(e.target.value as Batch["post_lock_cancellation"])}><option value="keep">Keep the unit</option><option value="reassign">Offer it to a maybe</option><option value="drop">Drop it if the shop allows</option></select></div>
            <div className="acts"><button type="button" className="btn ghost" onClick={() => (editing ? setStep("list") : setStep("recipients"))}>Back</button><button type="button" className="btn primary" onClick={confirm} disabled={!!busy} data-testid="confirm">{editing ? "Save changes" : "Add this gift"}</button></div>
          </section>
        )}

        {step === "list" && (
          <section aria-labelledby="gx-list">
            <h1 className="title" id="gx-list">Gifts for your guests</h1>
            <p className="lead">Each gift's quantities follow the replies until its lock date. Send builds the priced proposal at the shop; approve keeps it.</p>
            <div data-testid="gifts">
              {gifts.map((g) => {
                const units = g.quantities.reduce((s, q) => s + q.quantity, 0);
                const total = g.quantities.reduce((s, q) => { const v = g.variants.find((x) => x.id === q.variant_id); return s + (v?.price_cents ?? 0) * q.quantity; }, 0);
                const currency = g.variants[0]?.currency ?? "CAD";
                return (
                  <div className="item" key={g.id} data-testid="gift">
                    <div>
                      <div style={{ fontWeight: 600 }}>{g.product_title}</div>
                      <div className="m">{g.shop_domain}; {units} units, {money(total, currency)}; {g.cutoff ? `locks ${dateOnly(g.cutoff)}` : "lock date set on approval"}{g.cart_id ? "; priced at the shop" : ""}{g.locked_at ? "; locked" : ""}</div>
                      <div className="m">{g.quantities.map((q) => `${g.variants.find((v) => v.id === q.variant_id)?.title ?? "Variant"} ${q.quantity}`).join(", ") || "no units yet"}</div>
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
                {thread.updates.length === 0 && <div className="row" style={{ gridTemplateColumns: "1fr" }}><span className="type">No posts yet. The vendor's agent posts here; your replies reach it through the same feed.</span></div>}
                {thread.updates.map((u) => (
                  <div className="row" key={u.id} style={{ gridTemplateColumns: "auto 1fr auto" }}>
                    <span className={`tag${u.kind === "reply" ? " quiet" : ""}`}>{KIND_LABEL[u.kind]}</span>
                    <span>{u.text}{u.expected_date ? ` (expected ${dateOnly(u.expected_date)})` : ""}{u.reference ? ` (${u.reference})` : ""}</span>
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
                <input aria-label="Ask about the gifts" placeholder="Ask: which gift locks first, why a product is missing, who is missing a name" value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} data-testid="ask" />
                <button type="button" className="btn primary small" onClick={ask}>Ask</button>
              </div>
            </div>
            {answer && <p className="lead" style={{ marginTop: 16 }} data-testid="answer">{answer}</p>}
          </section>
        )}

        {busy && <p className="hint" style={{ color: "var(--muted)", marginTop: 16 }} data-testid="busy">{busy}</p>}
        {error && <p className="error" role="alert" data-testid="gx-error">{error}</p>}
      </div>
      {summaryCard}
    </div>
  );
}
