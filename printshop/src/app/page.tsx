"use client";
import { useState, useSyncExternalStore } from "react";
import { addNote, listNotes, subscribe } from "../notes/store";
import { WebMcpProvider } from "./webmcp-provider";

const EMPTY: never[] = [];

/** A list of notes a person adds by hand and an agent adds through the add_note tool; both call addNote. */
export default function NotesPage() {
  const notes = useSyncExternalStore(subscribe, listNotes, () => EMPTY);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    try {
      addNote(draft);
      setDraft("");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main className="page">
      <header className="topbar">
        <span className="brand">Notes</span>
        <WebMcpProvider />
      </header>
      <section className="card">
        <label htmlFor="note">Note</label>
        <div className="row">
          <input id="note" className="input" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} data-testid="note-input" />
          <button type="button" className="btn primary" onClick={submit} data-testid="note-add">
            Add
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {notes.length === 0 ? (
          <p className="empty" data-testid="notes-empty">No notes yet.</p>
        ) : (
          <ul className="notes" data-testid="notes-list">
            {notes.map((n) => (
              <li key={n.id} data-testid="note">{n.text}</li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
