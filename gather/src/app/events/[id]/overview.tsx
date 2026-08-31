"use client";
import { useState } from "react";
import type { Snapshot } from "./dashboard";
import type { GuestStatus } from "../../../domain/types";
import { dateOnly, dateTime, money } from "../../../lib/format";
import { deliveryTarget } from "../../../lib/delivery";

const STATUS_LABEL: Record<GuestStatus, string> = { going: "Going", maybe: "Maybe", cant_go: "Can't go", no_reply: "No reply" };

/** A follow-up's sentence and the guest filter it opens, composed here from the structural row the server returns. */
function describe(f: Snapshot["follow_ups"][number], snap: Snapshot): string {
  const n = f.guest_ids.length;
  const guests = n === 1 ? "guest" : "guests";
  if (f.kind === "missing_value") {
    const label = snap.definitions.find((d) => d.id === f.definition_id)?.label ?? "an answer";
    return `${n} ${guests}${f.status ? ` ${STATUS_LABEL[f.status].toLowerCase()}` : ""} without ${label.toLowerCase()}`;
  }
  if (f.kind === "unresolved") return `${n} ${guests} still Maybe${f.deadline ? ` until ${dateOnly(f.deadline)}` : ""}`;
  const gift = snap.gifts.find((g) => g.id === f.gift_id);
  if (f.kind === "unservable") return `${n} ${guests} unservable for ${gift?.product_title ?? "a gift"}`;
  if (f.kind === "vendor_question") return `Vendor question on ${gift?.product_title ?? "a gift"} awaiting your reply`;
  if (f.kind === "vendor_issue") return `Vendor issue on ${n} ${n === 1 ? "unit" : "units"} of ${gift?.product_title ?? "a gift"}`;
  return `${n} ${guests} without a reply`;
}

export function Overview({ snap, invite, onChanged }: { snap: Snapshot; invite: string | null; onChanged: () => void }) {
  const { event, guests, counts, definitions, follow_ups } = snap;
  const [only, setOnly] = useState<string[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [moreGuests, setMoreGuests] = useState("");
  async function addGuests() {
    if (!moreGuests.trim()) return;
    const res = await fetch(`/api/events/${event.id}/guests/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: moreGuests }) });
    if (res.ok) { setMoreGuests(""); onChanged(); }
  }
  const shown = only ? guests.filter((g) => only.includes(g.id)) : guests;
  const guestDefs = definitions.filter((d) => d.scope === "guest");
  const going = counts.going;

  return (
    <div className="wrap">
      <div>
        <h1 className="title" data-testid="event-title">{event.title}</h1>
        <p className="lead">{[dateTime(event.starts_at), event.venue.name, event.venue.city].filter(Boolean).join(" / ")}</p>

        <section className="block" aria-labelledby="attendance">
          <div className="labelrow"><h2 id="attendance">Attendance</h2><span className="eyebrow">{going} going{event.spots ? ` of ${event.spots} spots` : ""}</span></div>
          <div className="stats" data-testid="stats">
            {(["going", "maybe", "cant_go", "no_reply"] as GuestStatus[]).map((s) => (
              <div className="stat" key={s} data-testid={`stat-${s}`}>
                <div className="n">{counts[s]}</div>
                <div className="l">{STATUS_LABEL[s]}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="block" aria-labelledby="followups">
          <div className="labelrow"><h2 id="followups">Follow-ups</h2><span className="eyebrow">Still needed</span></div>
          {follow_ups.length === 0 ? (
            <p className="hint" style={{ color: "var(--muted)" }} data-testid="followups-empty">No follow-ups</p>
          ) : (
            <div className="list" data-testid="followups">
              {follow_ups.map((f) => (
                <div className="row" key={`${f.kind}-${f.definition_id ?? f.status}`} style={{ gridTemplateColumns: "1fr auto" }}>
                  <span>{describe(f, snap)}</span>
                  <button type="button" className="tag" onClick={() => setOnly(only && only.join() === f.guest_ids.join() ? null : f.guest_ids)}>{only && only.join() === f.guest_ids.join() ? "Show everyone" : "Show them"}</button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="block" aria-labelledby="guests">
          <div className="labelrow"><h2 id="guests">Guests</h2><span className="eyebrow">{shown.length} shown{only ? ` of ${guests.length}` : ""}</span></div>
          <div className="field"><label htmlFor="more-guests">Add guests one per line</label><div className="row" style={{ gridTemplateColumns: "1fr auto", padding: 0, border: 0, gap: 8 }}><textarea id="more-guests" rows={2} value={moreGuests} onChange={(e) => setMoreGuests(e.target.value)} data-testid="more-guests" /><button type="button" className="btn ghost small" onClick={addGuests} disabled={!moreGuests.trim()} data-testid="add-guests">Add</button></div></div>
          {guests.length === 0 ? (
            <p className="hint" style={{ color: "var(--muted)" }} data-testid="guests-empty">No guests yet</p>
          ) : (
            <div className="list" style={{ overflowX: "auto" }}>
              <table className="guests" data-testid="guests">
                <thead>
                  <tr><th>Guest</th><th>Reply</th>{guestDefs.map((d) => <th key={d.id}>{d.label}</th>)}</tr>
                </thead>
                <tbody>
                  {shown.map((g) => (
                    <tr key={g.id} data-testid="guest-row">
                      <td>{g.display_name}</td>
                      <td className={g.status === "going" ? "st" : "st no"}>{STATUS_LABEL[g.status]}</td>
                      {guestDefs.map((d) => {
                        const v = g.values[d.id];
                        const labels = Array.isArray(v) ? (v as string[]).map((x) => d.constraints.options?.find((o) => o.value === x)?.label ?? x).join(", ") : v === undefined || v === "" ? "" : String(v);
                        const required = d.required_rule === "always" || (d.required_rule === "going" && g.status === "going");
                        return <td key={d.id}>{labels || (required ? <span className="missing">missing</span> : <span className="quiet">not given</span>)}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="block" aria-labelledby="gifts">
          <div className="labelrow"><h2 id="gifts">Gifts</h2><span className="eyebrow">{snap.gifts.length} chosen</span></div>
          {snap.gifts.length === 0 ? (
            <p className="hint" style={{ color: "var(--muted)" }} data-testid="gifts-empty">No gift chosen yet</p>
          ) : (
            <div className="list" data-testid="gifts">
              {snap.gifts.map((g) => {
                const units = g.quantities.reduce((s, q) => s + q.quantity, 0);
                const status = g.locked_at ? "locked" : g.cutoff ? "approved" : g.cart_id ? "priced" : "draft";
                return (
                  <div className="row" key={g.id} data-testid="gift-row" style={{ gridTemplateColumns: "1fr auto" }}>
                    <span>{g.product_title}</span>
                    <span className="type">{[g.shop_domain, `${units} ${units === 1 ? "unit" : "units"}`, status].filter(Boolean).join(" / ")}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="block" aria-labelledby="setup">
          <div className="labelrow"><h2 id="setup">Event setup</h2><span className="eyebrow">Live edits</span></div>
          {editing ? <SetupForm snap={snap} onDone={() => { setEditing(false); onChanged(); }} /> : (
            <div className="list">
              <div className="row" style={{ gridTemplateColumns: "1fr auto" }}><span>{event.title}{event.host ? ` hosted by ${event.host}` : ""}</span><button type="button" className="btn ghost small" onClick={() => setEditing(true)} data-testid="edit-setup">Edit</button></div>
              <div className="row" style={{ gridTemplateColumns: "1fr" }}><span className="type">{[dateTime(event.starts_at), event.venue.name, event.venue.line1, event.venue.city, event.venue.region, event.venue.postal_code, event.venue.country].filter(Boolean).join(" / ")}</span></div>
              <div className="row" style={{ gridTemplateColumns: "1fr" }}><span className="type">{[event.spots ? `${event.spots} spots` : "no spot limit", event.cost_per_person_cents !== null ? `${money(event.cost_per_person_cents)} per person` : "no cost per person", event.rsvp_deadline ? `replies by ${dateOnly(event.rsvp_deadline)}` : "no RSVP deadline"].join(" / ")}</span></div>
              <div className="row" style={{ gridTemplateColumns: "1fr" }}><span className="type" data-testid="setup-delivery">Gifts to {deliveryTarget(event).label}{deliveryTarget(event).needed_by ? ` by ${dateOnly(deliveryTarget(event).needed_by)}` : " with no date yet"}</span></div>
            </div>
          )}
        </section>
      </div>

      <aside className="side">
        <div className="eyebrow" style={{ marginBottom: 12 }}>Replies</div>
        <div className="dark-card" data-testid="replies-card">
          <div className="in">
            <h2>{going} going</h2>
            <div className="when">Counts follow the replies</div>
            {definitions.filter((d) => d.value_type === "enum" || d.value_type === "multi_enum").map((d) => (
              <div key={d.id}>
                {(d.constraints.options ?? []).map((o) => {
                  const n = guests.filter((g) => g.status === "going" && (Array.isArray(g.values[d.id]) ? (g.values[d.id] as string[]).includes(o.value) : g.values[d.id] === o.value)).length;
                  return <div className="kv" key={o.value}><span>{o.label}</span><span>{n}</span></div>;
                })}
              </div>
            ))}
            {follow_ups.filter((f) => f.kind === "missing_value").map((f) => (
              <div className="kv" key={f.definition_id}><span>Missing {definitions.find((d) => d.id === f.definition_id)?.label.toLowerCase()}</span><span>{f.guest_ids.length}</span></div>
            ))}
            {invite && <div className="note" data-testid="invite-link">{invite}</div>}
          </div>
        </div>
      </aside>
    </div>
  );
}

/** The editable details after publish; PATCH writes them and the snapshot follows. */
function SetupForm({ snap, onDone }: { snap: Snapshot; onDone: () => void }) {
  const e = snap.event;
  const [form, setForm] = useState({ title: e.title, host: e.host, starts_at: e.starts_at.slice(0, 16), spots: e.spots?.toString() ?? "", cost: e.cost_per_person_cents !== null ? (e.cost_per_person_cents / 100).toString() : "", rsvp_deadline: e.rsvp_deadline ?? "", description: e.description, venue: e.venue, needed_by: e.delivery?.needed_by ?? "", destination: e.delivery?.destination ?? "venue" });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    const res = await fetch(`/api/events/${e.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: form.title, host: form.host, starts_at: new Date(form.starts_at).toISOString(), spots: form.spots ? Number(form.spots) : null, cost_per_person_cents: form.cost ? Math.round(Number(form.cost) * 100) : null, rsvp_deadline: form.rsvp_deadline || null, description: form.description, venue: form.venue, delivery: { destination: form.destination, address: e.delivery?.address ?? null, needed_by: form.needed_by || null } }) });
    if (!res.ok) { setError(((await res.json()) as { error: string }).error); return; }
    onDone();
  }
  return (
    <div data-testid="setup-form">
      <div className="field"><label htmlFor="s-title">Title</label><input id="s-title" value={form.title} onChange={(ev) => setForm({ ...form, title: ev.target.value })} /></div>
      <div className="grid2">
        <div className="field"><label htmlFor="s-starts">Date and time</label><input id="s-starts" type="datetime-local" value={form.starts_at} onChange={(ev) => setForm({ ...form, starts_at: ev.target.value })} /></div>
        <div className="field"><label htmlFor="s-host">Host</label><input id="s-host" value={form.host} onChange={(ev) => setForm({ ...form, host: ev.target.value })} /></div>
      </div>
      <div className="grid3">
        <div className="field"><label htmlFor="s-spots">Spots</label><input id="s-spots" type="number" value={form.spots} onChange={(ev) => setForm({ ...form, spots: ev.target.value })} /></div>
        <div className="field"><label htmlFor="s-cost">Cost per person</label><input id="s-cost" type="number" step="0.01" value={form.cost} onChange={(ev) => setForm({ ...form, cost: ev.target.value })} /></div>
        <div className="field"><label htmlFor="s-deadline">RSVP deadline</label><input id="s-deadline" type="date" value={form.rsvp_deadline} onChange={(ev) => setForm({ ...form, rsvp_deadline: ev.target.value })} /></div>
      </div>
      <div className="grid2">
        <div className="field"><label htmlFor="s-needed">Gifts needed by</label><input id="s-needed" type="date" value={form.needed_by} onChange={(ev) => setForm({ ...form, needed_by: ev.target.value })} data-testid="setup-needed-by" /></div>
        <div className="field"><label htmlFor="s-dest">Gifts delivered to</label><select id="s-dest" value={form.destination} onChange={(ev) => setForm({ ...form, destination: ev.target.value as "venue" | "address" })}><option value="venue">The venue</option><option value="address" disabled={!e.delivery?.address}>Another address{e.delivery?.address ? "" : " (set on the draft)"}</option></select></div>
      </div>
      <div className="field"><label htmlFor="s-desc">Description</label><textarea id="s-desc" rows={3} value={form.description} onChange={(ev) => setForm({ ...form, description: ev.target.value })} /></div>
      <div style={{ display: "flex", gap: 10 }}>
        <button type="button" className="btn primary" onClick={save} data-testid="save-setup">Save</button>
        <button type="button" className="btn ghost" onClick={onDone}>Cancel</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
