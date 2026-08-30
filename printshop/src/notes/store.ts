/**
 * The page's own state: a list of notes in memory. The Add button and the WebMCP tools call the
 * same two functions, so an agent and a person change the same list (webmcp skill, rule 1).
 */
export type Note = { id: number; text: string; created_at: string };

let notes: Note[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

export function listNotes(): Note[] {
  return notes;
}

export function addNote(text: string): Note {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("A note needs some text.");
  const note: Note = { id: nextId++, text: trimmed, created_at: new Date().toISOString() };
  notes = [...notes, note];
  for (const listener of listeners) listener();
  return note;
}

/** Subscribes a React component (useSyncExternalStore) to changes; returns the unsubscribe. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test hook: an empty list and a fresh id counter. */
export function resetNotes(): void {
  notes = [];
  nextId = 1;
  for (const listener of listeners) listener();
}
