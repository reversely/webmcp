"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Library, LibraryQuestion } from "../domain/store";
import type { GuestStatus, ValueType } from "../domain/types";
import { dateTime, money } from "../lib/format";

type Draft = {
  title: string;
  host: string;
  starts_at: string;
  venue: { name: string; line1: string; city: string; region: string; postal_code: string; country: string };
  spots: string;
  cost_per_person: string;
  rsvp_deadline: string;
  description: string;
  invite_extras: string[];
  response_options: GuestStatus[];
  settings: Library["event_defaults"]["settings"];
  delivery: { destination: "venue" | "address"; address: { name: string; line1: string; city: string; region: string; postal_code: string; country: string }; needed_by: string };
};

/** A question on the draft: a library row the organizer kept or wrote, with its options in their words. */
type DraftQuestion = { key: string; label: string; scope: LibraryQuestion["scope"]; value_type: ValueType; options: string[]; required_rule: LibraryQuestion["required_rule"]; max_length?: number };

const STATUS_LABEL: Record<GuestStatus, string> = { going: "Going", maybe: "Maybe", cant_go: "Can't go", no_reply: "No reply" };
const TYPE_LABEL: Record<ValueType, string> = { text: "Text", number: "Number", boolean: "Yes or no", enum: "One choice", multi_enum: "Several choices", date: "Date", file: "File", reference: "A record" };
const SETTING_LABEL: Record<keyof Draft["settings"], string> = {
  guest_approval: "Guests count only after your approval",
  reminders: "Reminder before the RSVP deadline",
  reask_on_change: "Re-ask guests when a question changes",
  order_approval: "Your approval before any cart is kept"
};

function fromLibrary(q: LibraryQuestion): DraftQuestion {
  return { key: q.key, label: q.label, scope: q.scope, value_type: q.value_type, options: (q.constraints.options ?? []).map((o) => o.label), required_rule: q.required_rule, max_length: q.constraints.max_length };
}

function slug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "option";
}

export function DraftPage({ library }: { library: Library }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>({
    title: "",
    host: "",
    starts_at: "",
    venue: { name: "", line1: "", city: "", region: "", postal_code: "", country: "" },
    spots: "",
    cost_per_person: "",
    rsvp_deadline: "",
    description: "",
    invite_extras: [],
    response_options: library.event_defaults.response_options,
    settings: library.event_defaults.settings,
    delivery: { destination: "venue", address: { name: "", line1: "", city: "", region: "", postal_code: "", country: "" }, needed_by: "" }
  });
  const [questions, setQuestions] = useState<DraftQuestion[]>(library.questions.filter((q) => q.seed).map(fromLibrary));
  const [extraDraft, setExtraDraft] = useState("");
  const [customDraft, setCustomDraft] = useState("");
  const [guestList, setGuestList] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const setVenue = (key: keyof Draft["venue"], value: string) => setDraft((d) => ({ ...d, venue: { ...d.venue, [key]: value } }));
  // A required choice question with no options is unsatisfiable on the invite, so publish waits for its choices.
  const emptyRequiredChoice = questions.find((q) => (q.value_type === "enum" || q.value_type === "multi_enum") && q.required_rule !== "never" && q.options.length === 0);
  const canPublish = draft.title.trim() && draft.starts_at && draft.venue.city.trim() && draft.venue.country.trim() && !emptyRequiredChoice;

  function toggleStatus(status: GuestStatus) {
    set("response_options", draft.response_options.includes(status) ? draft.response_options.filter((s) => s !== status) : [...draft.response_options, status]);
  }
  function addFromLibrary(q: LibraryQuestion) {
    if (!questions.some((x) => x.key === q.key)) setQuestions([...questions, fromLibrary(q)]);
  }
  function addCustom() {
    const label = customDraft.trim();
    if (!label) return;
    setQuestions([...questions, { key: `q_${slug(label)}_${questions.length + 1}`, label, scope: "guest", value_type: "text", options: [], required_rule: "never", max_length: 200 }]);
    setCustomDraft("");
  }
  function updateQuestion(i: number, patch: Partial<DraftQuestion>) {
    setQuestions(questions.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  }

  async function publish() {
    setPublishing(true);
    setError(null);
    try {
      const body = {
        title: draft.title.trim(),
        host: draft.host.trim(),
        starts_at: new Date(draft.starts_at).toISOString(),
        venue: draft.venue,
        spots: draft.spots ? Number(draft.spots) : null,
        cost_per_person_cents: draft.cost_per_person ? Math.round(Number(draft.cost_per_person) * 100) : null,
        rsvp_deadline: draft.rsvp_deadline || null,
        description: draft.description,
        invite_extras: draft.invite_extras,
        response_options: draft.response_options,
        settings: draft.settings,
        delivery: { destination: draft.delivery.destination, address: draft.delivery.destination === "address" ? draft.delivery.address : null, needed_by: draft.delivery.needed_by || null }
      };
      const created = await fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!created.ok) throw new Error(((await created.json()) as { error: string }).error);
      const { id } = (await created.json()) as { id: string };
      const defs = await fetch(`/api/events/${id}/definitions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          definitions: questions.map((q) => ({
            key: q.key,
            label: q.label,
            scope: q.scope,
            value_type: q.value_type,
            constraints: { ...(q.max_length ? { max_length: q.max_length } : {}), ...(q.value_type === "enum" || q.value_type === "multi_enum" ? { options: q.options.map((label) => ({ value: slug(label), label })) } : {}) },
            required_rule: q.required_rule
          }))
        })
      });
      if (!defs.ok) throw new Error(((await defs.json()) as { error: string }).error);
      if (guestList.trim()) {
        const imported = await fetch(`/api/events/${id}/guests/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: guestList }) });
        if (!imported.ok) throw new Error(((await imported.json()) as { error: string }).error);
      }
      const published = await fetch(`/api/events/${id}/publish`, { method: "POST" });
      if (!published.ok) throw new Error(((await published.json()) as { error: string }).error);
      router.push(`/events/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPublishing(false);
    }
  }

  return (
    <>
      <header className="band">
        <a className="brand" href="/">Gather</a>
        <div className="right">
          <span className="pill">Draft</span>
          <button className="btn primary" type="button" onClick={publish} disabled={!canPublish || publishing} data-testid="publish">
            {publishing ? "Publishing" : "Publish"}
          </button>
        </div>
      </header>
      <main className="sheet">
        <div className="wrap">
          <div>
            <h1 className="title">New event</h1>
            <p className="lead">Details and questions for the invite on the right</p>

            <section className="block" aria-labelledby="details">
              <div className="labelrow"><h2 id="details">Details</h2><span className="eyebrow">Shown on the invite</span></div>
              <div className="field"><label htmlFor="title">Title</label><input id="title" value={draft.title} onChange={(e) => set("title", e.target.value)} data-testid="title" /></div>
              <div className="grid2">
                <div className="field"><label htmlFor="starts_at">Date and time</label><input id="starts_at" type="datetime-local" value={draft.starts_at} onChange={(e) => set("starts_at", e.target.value)} data-testid="starts_at" /></div>
                <div className="field"><label htmlFor="host">Host</label><input id="host" value={draft.host} onChange={(e) => set("host", e.target.value)} data-testid="host" /></div>
              </div>
              <div className="field"><label htmlFor="venue_name">Venue</label><input id="venue_name" value={draft.venue.name} onChange={(e) => setVenue("name", e.target.value)} data-testid="venue_name" /></div>
              <div className="field"><label htmlFor="line1">Street address</label><input id="line1" value={draft.venue.line1} onChange={(e) => setVenue("line1", e.target.value)} data-testid="line1" /></div>
              <div className="grid3">
                <div className="field"><label htmlFor="city">City</label><input id="city" value={draft.venue.city} onChange={(e) => setVenue("city", e.target.value)} data-testid="city" /></div>
                <div className="field"><label htmlFor="region">Region</label><input id="region" value={draft.venue.region} onChange={(e) => setVenue("region", e.target.value)} data-testid="region" /></div>
                <div className="field"><label htmlFor="postal_code">Postal code</label><input id="postal_code" value={draft.venue.postal_code} onChange={(e) => setVenue("postal_code", e.target.value)} data-testid="postal_code" /></div>
              </div>
              <div className="grid3">
                <div className="field"><label htmlFor="country">Country code</label><input id="country" value={draft.venue.country} onChange={(e) => setVenue("country", e.target.value.toUpperCase())} maxLength={2} data-testid="country" /></div>
                <div className="field"><label htmlFor="spots">Spots</label><input id="spots" type="number" min={1} value={draft.spots} onChange={(e) => set("spots", e.target.value)} data-testid="spots" /></div>
                <div className="field"><label htmlFor="cost">Cost per person</label><input id="cost" type="number" min={0} step="0.01" value={draft.cost_per_person} onChange={(e) => set("cost_per_person", e.target.value)} data-testid="cost" /></div>
              </div>
              <div className="grid2">
                <div className="field"><label htmlFor="deadline">RSVP deadline</label><input id="deadline" type="date" value={draft.rsvp_deadline} onChange={(e) => set("rsvp_deadline", e.target.value)} data-testid="deadline" /></div>
                <div className="field">
                  <label htmlFor="extra">Invite extras</label>
                  <div className="chips" data-testid="extras">
                    {draft.invite_extras.map((x) => (
                      <button key={x} type="button" className="chip on" onClick={() => set("invite_extras", draft.invite_extras.filter((y) => y !== x))} aria-label={`Remove ${x}`}>{x}</button>
                    ))}
                    <span className="chip"><input id="extra" placeholder="Add a line" value={extraDraft} onChange={(e) => setExtraDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && extraDraft.trim()) { set("invite_extras", [...draft.invite_extras, extraDraft.trim()]); setExtraDraft(""); } }} /></span>
                  </div>
                </div>
              </div>
              <div className="field"><label htmlFor="description">Description</label><textarea id="description" rows={3} value={draft.description} onChange={(e) => set("description", e.target.value)} /></div>
            </section>

            <section className="block" aria-labelledby="delivery">
              <div className="labelrow"><h2 id="delivery">Gift delivery</h2></div>
              <div className="field">
                <label>Delivered to</label>
                <div className="chips" data-testid="delivery-destination">
                  <button type="button" className={`chip${draft.delivery.destination === "venue" ? " on" : ""}`} aria-pressed={draft.delivery.destination === "venue"} onClick={() => set("delivery", { ...draft.delivery, destination: "venue" })}>The venue</button>
                  <button type="button" className={`chip${draft.delivery.destination === "address" ? " on" : ""}`} aria-pressed={draft.delivery.destination === "address"} onClick={() => set("delivery", { ...draft.delivery, destination: "address" })}>Another address</button>
                </div>
              </div>
              {draft.delivery.destination === "address" && (
                <>
                  <div className="field"><label htmlFor="d-name">Name at the address</label><input id="d-name" value={draft.delivery.address.name} onChange={(e) => set("delivery", { ...draft.delivery, address: { ...draft.delivery.address, name: e.target.value } })} /></div>
                  <div className="field"><label htmlFor="d-line1">Street address</label><input id="d-line1" value={draft.delivery.address.line1} onChange={(e) => set("delivery", { ...draft.delivery, address: { ...draft.delivery.address, line1: e.target.value } })} /></div>
                  <div className="grid3">
                    <div className="field"><label htmlFor="d-city">City</label><input id="d-city" value={draft.delivery.address.city} onChange={(e) => set("delivery", { ...draft.delivery, address: { ...draft.delivery.address, city: e.target.value } })} /></div>
                    <div className="field"><label htmlFor="d-region">Region</label><input id="d-region" value={draft.delivery.address.region} onChange={(e) => set("delivery", { ...draft.delivery, address: { ...draft.delivery.address, region: e.target.value } })} /></div>
                    <div className="field"><label htmlFor="d-postal">Postal code</label><input id="d-postal" value={draft.delivery.address.postal_code} onChange={(e) => set("delivery", { ...draft.delivery, address: { ...draft.delivery.address, postal_code: e.target.value } })} /></div>
                  </div>
                  <div className="field"><label htmlFor="d-country">Country code</label><input id="d-country" maxLength={2} value={draft.delivery.address.country} onChange={(e) => set("delivery", { ...draft.delivery, address: { ...draft.delivery.address, country: e.target.value.toUpperCase() } })} /></div>
                </>
              )}
              <div className="field" style={{ maxWidth: 320 }}><label htmlFor="needed_by">Gifts needed by</label><input id="needed_by" type="date" value={draft.delivery.needed_by} onChange={(e) => set("delivery", { ...draft.delivery, needed_by: e.target.value })} data-testid="needed_by" /></div>
            </section>

            <section className="block" aria-labelledby="questions">
              <div className="labelrow"><h2 id="questions">RSVP questions</h2><span className="eyebrow">Guests answer these</span></div>
              <div className="field">
                <label>Response options</label>
                <div className="chips">
                  {(["going", "maybe", "cant_go"] as GuestStatus[]).map((s) => (
                    <button key={s} type="button" className={`chip${draft.response_options.includes(s) ? " on" : ""}`} aria-pressed={draft.response_options.includes(s)} onClick={() => toggleStatus(s)}>{STATUS_LABEL[s]}</button>
                  ))}
                </div>
              </div>
              <div className="list" data-testid="questions">
                {questions.map((q, i) => (
                  <div key={q.key}>
                    <div className="row">
                      <input aria-label={`Question ${i + 1}`} value={q.label} onChange={(e) => updateQuestion(i, { label: e.target.value })} style={{ border: 0, padding: 0, font: "inherit", width: "100%" }} />
                      <span className="type">{TYPE_LABEL[q.value_type]}</span>
                      <button type="button" className={`tag${q.required_rule === "never" ? " quiet" : ""}`} onClick={() => updateQuestion(i, { required_rule: q.required_rule === "never" ? "going" : "never" })} aria-pressed={q.required_rule !== "never"}>
                        {q.required_rule === "never" ? "Optional" : "Required when going"}
                      </button>
                      <button type="button" className="btn ghost small" onClick={() => setQuestions(questions.filter((_, j) => j !== i))} aria-label={`Remove ${q.label}`}>Remove</button>
                    </div>
                    {(q.value_type === "enum" || q.value_type === "multi_enum") && (
                      <div className="subrow" data-testid={`options-${q.key}`}>
                        {q.options.map((o) => (
                          <button key={o} type="button" className="chip on" onClick={() => updateQuestion(i, { options: q.options.filter((x) => x !== o) })} aria-label={`Remove ${o}`}>{o}</button>
                        ))}
                        <span className="chip">
                          <input aria-label={`Add a choice to ${q.label}`} placeholder="Add a choice" onKeyDown={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (e.key === "Enter" && v && !q.options.some((o) => slug(o) === slug(v))) { updateQuestion(i, { options: [...q.options, v] }); (e.target as HTMLInputElement).value = ""; } }} />
                        </span>
                        {q.options.length === 0 && <span className="hint">Choices for guests</span>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="chips" style={{ marginTop: 12 }}>
                {library.questions.filter((q) => !questions.some((x) => x.key === q.key)).map((q) => (
                  <button key={q.key} type="button" className="chip" onClick={() => addFromLibrary(q)}>{q.label}</button>
                ))}
                <span className="chip"><input aria-label="A question in your words" placeholder="A question in your words" value={customDraft} onChange={(e) => setCustomDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCustom()} /></span>
              </div>
            </section>

            <section className="block" aria-labelledby="guestlist">
              <div className="labelrow"><h2 id="guestlist">Guest list</h2></div>
              <div className="field"><label htmlFor="guest-list">One guest per line as a name a bare email or a name with an email</label><textarea id="guest-list" rows={5} value={guestList} onChange={(e) => setGuestList(e.target.value)} data-testid="guest-list" /></div>
            </section>

            <section className="block" aria-labelledby="settings">
              <div className="labelrow"><h2 id="settings">Settings</h2><span className="eyebrow">Approvals and reminders</span></div>
              {(Object.keys(SETTING_LABEL) as (keyof Draft["settings"])[]).map((k) => (
                <button key={k} type="button" className="toggle" role="switch" aria-checked={draft.settings[k]} onClick={() => set("settings", { ...draft.settings, [k]: !draft.settings[k] })}>
                  <span>{SETTING_LABEL[k]}</span>
                  <span className={`sw${draft.settings[k] ? " on" : ""}`} />
                </button>
              ))}
            </section>

            <div className="foot">
              <p className="note">Publish to create the invite link</p>
              <button className="btn primary" type="button" onClick={publish} disabled={!canPublish || publishing}>{publishing ? "Publishing" : "Publish"}</button>
            </div>
            {emptyRequiredChoice && <p className="hint" style={{ color: "var(--muted)" }} data-testid="publish-blocker">Add a choice to {emptyRequiredChoice.label}</p>}
            {error && <p className="error" role="alert">{error}</p>}
          </div>

          <aside className="side">
            <div className="eyebrow" style={{ marginBottom: 12 }}>Invite preview</div>
            <div className="dark-card" data-testid="invite-preview">
              <div className="hero">{draft.host.trim() && <span className="badge">Hosted by {draft.host.trim()}</span>}</div>
              <div className="in">
                <h2>{draft.title.trim() || "Your event"}</h2>
                <div className="when">
                  {draft.starts_at ? dateTime(new Date(draft.starts_at).toISOString()) : "Date and time"}
                  {(draft.venue.name || draft.venue.line1 || draft.venue.city) && <><br /><span style={{ display: "inline-flex", gap: 10, flexWrap: "wrap" }}>{[draft.venue.name, draft.venue.line1, draft.venue.city].filter(Boolean).map((part) => <span key={part}>{part}</span>)}</span></>}
                  {draft.cost_per_person && <><br />{money(Math.round(Number(draft.cost_per_person) * 100))} per person</>}
                </div>
                {draft.invite_extras.length > 0 && <div className="extras">{draft.invite_extras.map((x) => <span key={x}>{x}</span>)}</div>}
                <div className="options">{draft.response_options.map((s) => <span key={s}>{STATUS_LABEL[s]}</span>)}</div>
                {questions.map((q) => (
                  <div className="q" key={q.key}>
                    <div className="l">{q.label}</div>
                    {q.value_type === "enum" || q.value_type === "multi_enum" ? <div className="opts">{q.options.map((o) => <i key={o}>{o}</i>)}</div> : <div className="box" />}
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}
