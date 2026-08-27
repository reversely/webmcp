"use client";
import "tldraw/tldraw.css";
import { Tldraw, createShapeId, getSnapshot, toRichText, type Editor, type TLEditorSnapshot } from "tldraw";

/** The PRD 16 demo notes, placed on first load when the project has no saved board. */
const DEMO_NOTES: { text: string; x: number; y: number; color: "yellow" | "light-green" | "light-blue" | "orange" }[] = [
  { text: "12 × 18 living room", x: 0, y: 0, color: "yellow" },
  { text: "Need sofa", x: 240, y: 0, color: "light-green" },
  { text: "Coffee table", x: 480, y: 0, color: "light-green" },
  { text: "Ottoman", x: 720, y: 0, color: "light-green" },
  { text: "big rug underneath everything", x: 0, y: 240, color: "light-green" },
  { text: "$2500 max", x: 240, y: 240, color: "yellow" },
  { text: "Need Sept 15", x: 480, y: 240, color: "yellow" }
];

function seed(editor: Editor) {
  editor.createShapes(
    DEMO_NOTES.map((n) => ({ id: createShapeId(), type: "note", x: n.x, y: n.y, props: { color: n.color, richText: toRichText(n.text) } }))
  );
  // Swatches: filled rectangles whose label names the colour the compiler should read.
  editor.createShapes([
    { id: createShapeId(), type: "geo", x: 720, y: 240, props: { geo: "rectangle", w: 200, h: 90, fill: "solid", color: "orange", richText: toRichText("warm brown") } },
    { id: createShapeId(), type: "geo", x: 720, y: 350, props: { geo: "rectangle", w: 200, h: 90, fill: "solid", color: "blue", richText: toRichText("dark navy") } }
  ]);
}

export type BoardCanvasProps = {
  initial: TLEditorSnapshot | null;
  onReady: (editor: Editor) => void;
  onChange: (snapshot: TLEditorSnapshot) => void;
};

export default function BoardCanvas({ initial, onReady, onChange }: BoardCanvasProps) {
  return (
    <Tldraw
      snapshot={initial ?? undefined}
      onMount={(editor) => {
        // The store survives a dev-mode StrictMode remount, so the guard is the store, not the prop.
        if (!initial && editor.getCurrentPageShapeIds().size === 0) {
          seed(editor);
          editor.selectNone();
          onChange(getSnapshot(editor.store));
        }
        editor.zoomToFit({ animation: { duration: 0 } });
        onReady(editor);
        return editor.store.listen(() => onChange(getSnapshot(editor.store)), { scope: "document", source: "user" });
      }}
    />
  );
}
