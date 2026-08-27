"use client";
import "tldraw/tldraw.css";
import { useState } from "react";
import { Tldraw, createShapeId, getSnapshot, toRichText, type Editor, type TLEditorSnapshot } from "tldraw";
import styles from "./board.module.css";

type NoteColor = "yellow" | "light-green" | "light-blue" | "orange" | "blue" | "red" | "green" | "grey" | "violet";

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

export type BoardCanvasProps = {
  initial: TLEditorSnapshot | null;
  onReady: (editor: Editor) => void;
  onChange: (snapshot: TLEditorSnapshot) => void;
};

export default function BoardCanvas({ initial, onReady, onChange }: BoardCanvasProps) {
  const [empty, setEmpty] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  return (
    <div data-testid="board-canvas" style={{ position: "absolute", inset: 0 }}>
      <Tldraw
        snapshot={initial ?? undefined}
        onMount={(ed) => {
          ed.zoomToFit({ animation: { duration: 0 } });
          expose(ed);
          setEditor(ed);
          setEmpty(ed.getCurrentPageShapeIds().size === 0);
          onReady(ed);
          const stopUser = ed.store.listen(() => onChange(getSnapshot(ed.store)), { scope: "document", source: "user" });
          const stopAll = ed.store.listen(() => setEmpty(ed.getCurrentPageShapeIds().size === 0), { scope: "document" });
          return () => {
            stopUser();
            stopAll();
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
