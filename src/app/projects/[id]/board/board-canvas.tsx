"use client";
import "tldraw/tldraw.css";
import { useMemo, useRef, useState } from "react";
import { Tldraw, createShapeId, toRichText, useEditor, useValue, type Editor, type TLComponents, type TLRecord } from "tldraw";
import { PendingChanges, type BoardDelta, type BoardRecord } from "./board-sync";
import { roleColour, setLocalCursor, usePresenceMembers } from "./presence-store";
import { useIdentity } from "../../../identity";
import styles from "./board.module.css";

type NoteColor = "yellow" | "light-green" | "light-blue" | "orange" | "blue" | "red" | "green" | "grey" | "violet";

/** Local edits are sent this long after the last one. */
const SAVE_MS = 800;
/** The other browser's edits are fetched on this interval. */
const POLL_MS = 2000;
/** A cursor older than this is not drawn: three missed heartbeats, as in the top bar. */
const CURSOR_STALE_MS = 15000;

declare global {
  interface Window {
    /** The live tldraw editor, for Playwright and the console; set while the board is mounted. */
    __tldraw_editor?: Editor;
    __tldraw_addNote?: (text: string, x: number, y: number, color?: NoteColor) => void;
    __tldraw_addSwatch?: (color: NoteColor, x: number, y: number, label?: string) => void;
  }
}

function expose(editor: Editor) {
  window.__tldraw_editor = editor;
  window.__tldraw_addNote = (text, x, y, color = "yellow") => {
    editor.createShapes([{ id: createShapeId(), type: "note", x, y, props: { color, richText: toRichText(text) } }]);
  };
  window.__tldraw_addSwatch = (color, x, y, label = "") => {
    editor.createShapes([{ id: createShapeId(), type: "geo", x, y, props: { geo: "rectangle", w: 200, h: 90, fill: "solid", color, richText: toRichText(label) } }]);
  };
}

function unexpose() {
  delete window.__tldraw_editor;
  delete window.__tldraw_addNote;
  delete window.__tldraw_addSwatch;
}

/** The board as GET /spec returns it on first load: every record and the version they add up to. */
export type BoardInitial = { version: number; records: BoardRecord[] } | null;
export type SaveState = "idle" | "saving" | "saved" | "failed";

export type BoardCanvasProps = {
  projectId: string;
  initial: BoardInitial;
  onReady: (editor: Editor) => void;
  onSaveState: (state: SaveState) => void;
};

/**
 * Keeps one tldraw store in step with the server (#18): local document changes (source "user")
 * are folded into a pending set and PUT 800 ms after the last one; every 2 s the client asks for
 * what others wrote after the version it holds and merges it as remote changes, skipping records
 * the local user touched inside that window. Requests run one at a time so versions only advance.
 */
function startSync(editor: Editor, projectId: string, initial: BoardInitial, onSaveState: (s: SaveState) => void): () => void {
  const store = editor.store;
  const pending = new PendingChanges();
  let version = initial?.version ?? 0;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let chain: Promise<void> = Promise.resolve();
  const enqueue = (fn: () => Promise<void>) => {
    chain = chain.then(fn).catch(() => {});
  };

  function applyRemote(delta: BoardDelta) {
    const { put, remove } = pending.filterRemote(delta, Date.now(), POLL_MS);
    version = Math.max(version, delta.version);
    if (put.length === 0 && remove.length === 0) return;
    try {
      store.mergeRemoteChanges(() => {
        if (put.length) store.put(put as unknown as TLRecord[]);
        if (remove.length) store.remove(remove as TLRecord["id"][]);
      });
    } catch (e) {
      console.warn(`Board sync could not apply ${put.length} put and ${remove.length} removed records: ${(e as Error).message}`);
    }
  }

  if (initial && initial.records.length > 0) applyRemote({ version: initial.version, put: initial.records, remove: [] });

  async function flush() {
    if (stopped || pending.empty) return;
    const changes = pending.take();
    try {
      const res = await fetch(`/api/projects/${projectId}/spec`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ board_changes: changes, since: version }) });
      if (!res.ok) throw new Error(`PUT /spec answered ${res.status}`);
      const body = (await res.json()) as { board: BoardDelta };
      applyRemote(body.board);
      onSaveState(pending.empty ? "saved" : "saving");
    } catch {
      pending.restore(changes);
      onSaveState("failed");
    }
  }

  async function poll() {
    if (stopped) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/spec?since=${version}`, { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { board: BoardDelta };
      applyRemote(body.board);
    } catch {
      // A missed poll is not an error; the next one is two seconds away.
    }
  }

  const stopListening = store.listen(
    (entry) => {
      pending.record(entry.changes as never, Date.now());
      onSaveState("saving");
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = null;
        enqueue(flush);
      }, SAVE_MS);
    },
    { scope: "document", source: "user" }
  );
  const pollTimer = setInterval(() => enqueue(poll), POLL_MS);

  return () => {
    stopped = true;
    stopListening();
    clearInterval(pollTimer);
    if (saveTimer) clearTimeout(saveTimer);
  };
}

/** Every other active member's pointer, in their role's colour, positioned in viewport space over the canvas. */
function RemoteCursors({ projectId }: { projectId: string }) {
  const editor = useEditor();
  const members = usePresenceMembers();
  const identity = useIdentity(projectId);
  // useValue re-runs when the camera moves, because pageToViewport reads the camera signal.
  const cursors = useValue(
    "remote cursors",
    () => {
      const now = Date.now();
      return members
        .filter((m) => m.cursor && m.id !== identity?.member_id && now - Date.parse(m.last_seen) <= CURSOR_STALE_MS)
        .map((m) => ({ ...m, at: editor.pageToViewport(m.cursor!) }));
    },
    [editor, members, identity]
  );
  return (
    <div className={styles.cursorLayer} data-testid="remote-cursors">
      {cursors.map((m) => (
        <div key={m.id} className={styles.cursor} style={{ left: m.at.x, top: m.at.y }} data-testid="remote-cursor" data-member-id={m.id}>
          <span className={styles.cursorDot} style={{ background: roleColour(m.role) }} />
          <span className={styles.cursorLabel} style={{ background: roleColour(m.role) }}>{m.display_name}</span>
        </div>
      ))}
    </div>
  );
}

export default function BoardCanvas({ projectId, initial, onReady, onSaveState }: BoardCanvasProps) {
  const [empty, setEmpty] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const components = useMemo<TLComponents>(() => ({ InFrontOfTheCanvas: () => <RemoteCursors projectId={projectId} /> }), [projectId]);
  return (
    <div
      data-testid="board-canvas"
      style={{ position: "absolute", inset: 0 }}
      onPointerMove={(e) => {
        const ed = editorRef.current;
        if (ed) setLocalCursor(ed.screenToPage({ x: e.clientX, y: e.clientY }));
      }}
      onPointerLeave={() => setLocalCursor(null)}
    >
      <Tldraw
        components={components}
        onMount={(ed) => {
          const stopSync = startSync(ed, projectId, initial, onSaveState);
          ed.zoomToFit({ animation: { duration: 0 } });
          expose(ed);
          editorRef.current = ed;
          setEditor(ed);
          setEmpty(ed.getCurrentPageShapeIds().size === 0);
          onReady(ed);
          const stopAll = ed.store.listen(() => setEmpty(ed.getCurrentPageShapeIds().size === 0), { scope: "document" });
          return () => {
            stopSync();
            stopAll();
            editorRef.current = null;
            setLocalCursor(null);
            unexpose();
          };
        }}
      />
      {empty && (
        <div className={styles.emptyState} data-testid="board-empty">
          <p>Notes you add here become the plan: one note for the room size, one for the budget, one for the date, and one for each item you need. A filled rectangle is a colour swatch.</p>
          <button className="btn primary" type="button" onClick={() => editor?.setCurrentTool("note")}>
            Add a note
          </button>
        </div>
      )}
    </div>
  );
}
