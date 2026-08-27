"use client";
import { useState } from "react";

import { demoItems, DEMO_SPACE } from "./demo-layout";
import { Room3D } from "./Room3D";

/** Standalone check of the room with the demo layout; pass product image URLs to colour the proxies. */
export function Room3DPreview({ imageUrls = [] }: { imageUrls?: string[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const items = demoItems(imageUrls);
  const selected = items.find((i) => i.id === selectedId);
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <Room3D space={DEMO_SPACE} items={items} selectedId={selectedId} onSelect={setSelectedId} />
      <div style={{ position: "absolute", left: 12, top: 12, font: "13px/1.4 system-ui, sans-serif", color: "#1c2b36", background: "rgba(255,255,255,0.92)", border: "1px solid #dfe5e9", borderRadius: 6, padding: "8px 10px" }}>
        {selected ? `${selected.title}: ${selected.box.width_mm} × ${selected.box.depth_mm} × ${selected.box.height_mm} mm` : "Click an item to select it. Drag to orbit."}
      </div>
    </div>
  );
}
