"use client";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { RuleResult } from "../../../../domain/geometry";
import { itemKey, type Box, type Category, type Kind } from "../../../../domain/types";
import { formatFeetInches } from "../../../../domain/types";
import type { Opening, Wall } from "./room-estimate";

/**
 * Top-down SVG plan in project coordinates (PRD 12.1): x along the width, y along the length,
 * origin at the bottom-left corner, so screen y is flipped. Used read-only by the room stage and
 * interactively (drag, select, hover) by the items stage.
 */
export type PlanItem = {
  id: string;
  title: string;
  /** The project's phrase for the item; layout rules name items by it. */
  category: Category;
  kind: Kind;
  image_url: string | null;
  box: Box;
  placement: { x_mm: number; y_mm: number; rotation_deg: number };
  flagged: boolean;
};

export type PlanViewProps = {
  space: { width_mm: number; length_mm: number };
  door?: Opening | null;
  window?: Opening | null;
  items?: PlanItem[];
  selectedId?: string | null;
  clearances?: Record<string, number>;
  /** Evaluated layout rules: each draws a pass or fail mark between its subject and its objects. */
  rules?: RuleResult[];
  maxHeight?: number;
  onSelect?: (id: string) => void;
  onMove?: (id: string, x_mm: number, y_mm: number) => void;
  onDrop?: (id: string) => void;
};

const PAD = 56;

function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

/** Wall origin, along-wall unit vector, and inward normal, all in project coordinates. */
function wallFrame(wall: Wall, W: number, L: number) {
  switch (wall) {
    case "bottom":
      return { origin: { x: 0, y: 0 }, along: { x: 1, y: 0 }, inward: { x: 0, y: 1 } };
    case "top":
      return { origin: { x: 0, y: L }, along: { x: 1, y: 0 }, inward: { x: 0, y: -1 } };
    case "left":
      return { origin: { x: 0, y: 0 }, along: { x: 0, y: 1 }, inward: { x: 1, y: 0 } };
    case "right":
      return { origin: { x: W, y: 0 }, along: { x: 0, y: 1 }, inward: { x: -1, y: 0 } };
  }
}

export function PlanView({ space, door, window: win, items = [], selectedId, clearances, rules = [], maxHeight = 600, onSelect, onMove, onDrop }: PlanViewProps) {
  const { ref, width: containerWidth } = useWidth<HTMLDivElement>(640);
  const W = Math.max(space.width_mm, 1);
  const L = Math.max(space.length_mm, 1);
  const s = Math.max(0.01, Math.min((containerWidth - 2 * PAD) / W, (maxHeight - 2 * PAD) / L));
  const X = (x: number) => PAD + x * s;
  const Y = (y: number) => PAD + (L - y) * s;
  const svgW = W * s + 2 * PAD;
  const svgH = L * s + 2 * PAD;
  const [hoverId, setHoverId] = useState<string | null>(null);
  const drag = useRef<{ id: string; startX: number; startY: number; x0: number; y0: number } | null>(null);

  function onPointerDown(e: ReactPointerEvent<SVGGElement>, item: PlanItem) {
    if (!onMove) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: item.id, startX: e.clientX, startY: e.clientY, x0: item.placement.x_mm, y0: item.placement.y_mm };
    onSelect?.(item.id);
  }
  function onPointerMove(e: ReactPointerEvent<SVGGElement>) {
    const d = drag.current;
    if (!d || !onMove) return;
    onMove(d.id, Math.round(d.x0 + (e.clientX - d.startX) / s), Math.round(d.y0 - (e.clientY - d.startY) / s));
  }
  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (d) onDrop?.(d.id);
  }

  function openingPath(o: Opening, kind: "door" | "window") {
    const f = wallFrame(o.wall, W, L);
    const start = { x: f.origin.x + f.along.x * o.offset_mm, y: f.origin.y + f.along.y * o.offset_mm };
    const end = { x: start.x + f.along.x * o.width_mm, y: start.y + f.along.y * o.width_mm };
    if (kind === "window") {
      const t = 5;
      const nx = f.inward.x * t;
      const ny = f.inward.y * t;
      return (
        <g key={`${kind}-${o.wall}`}>
          <line x1={X(start.x)} y1={Y(start.y)} x2={X(end.x)} y2={Y(end.y)} stroke="var(--paper)" strokeWidth={4} />
          <line x1={X(start.x) - nx} y1={Y(start.y) + ny} x2={X(end.x) - nx} y2={Y(end.y) + ny} stroke="var(--ink)" strokeWidth={1} />
          <line x1={X(start.x) + nx} y1={Y(start.y) - ny} x2={X(end.x) + nx} y2={Y(end.y) - ny} stroke="var(--ink)" strokeWidth={1} />
          <line x1={X(start.x)} y1={Y(start.y)} x2={X(end.x)} y2={Y(end.y)} stroke="var(--ink-3)" strokeWidth={1} />
        </g>
      );
    }
    // Door: the leaf hinges at the opening's start and swings a quarter circle into the room.
    const r = o.width_mm;
    const pts: string[] = [];
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * (Math.PI / 2);
      const px = start.x + f.along.x * r * Math.cos(a) + f.inward.x * r * Math.sin(a);
      const py = start.y + f.along.y * r * Math.cos(a) + f.inward.y * r * Math.sin(a);
      pts.push(`${X(px)},${Y(py)}`);
    }
    const leaf = { x: start.x + f.inward.x * r, y: start.y + f.inward.y * r };
    return (
      <g key={`${kind}-${o.wall}`}>
        <line x1={X(start.x)} y1={Y(start.y)} x2={X(end.x)} y2={Y(end.y)} stroke="var(--paper)" strokeWidth={4} />
        <line x1={X(start.x)} y1={Y(start.y)} x2={X(leaf.x)} y2={Y(leaf.y)} stroke="var(--ink)" strokeWidth={1.5} />
        <polyline points={pts.join(" ")} fill="none" stroke="var(--ink-3)" strokeWidth={1} strokeDasharray="3 3" />
      </g>
    );
  }

  // Soft floors draw first so furniture sits on top of them.
  const ordered = [...items].sort((a, b) => Number(b.kind === "soft_floor") - Number(a.kind === "soft_floor"));
  const centreOf = (id: string) => items.find((i) => i.id === id)?.placement;
  const byName = (name: string) => items.find((i) => itemKey(i.category) === itemKey(name))?.placement;
  // One mark per evaluated rule: a line from the subject to each object, or a ring at the subject, coloured by its result.
  const marks = rules.flatMap((r, index) => {
    if (r.rule.relation === "text" || r.pass === null) return [];
    const subject = byName(r.rule.subject);
    if (!subject) return [];
    const colour = r.pass ? "var(--tag-green-text)" : "var(--tag-red-text)";
    const targets = r.rule.objects.map(byName).filter((p): p is NonNullable<typeof p> => p !== undefined);
    return [{ key: `rule-${index}`, colour, subject, targets, pass: r.pass, relation: r.rule.relation }];
  });
  const labels = hoverId
    ? Object.entries(clearances ?? {})
        .filter(([k]) => k.split("|").includes(hoverId))
        .map(([k, mm]) => {
          const [a, b] = k.split("|");
          const pa = centreOf(a);
          const pb = centreOf(b);
          return pa && pb ? { k, mm, pa, pb } : null;
        })
        .filter((v): v is NonNullable<typeof v> => v !== null)
    : [];

  return (
    <div ref={ref} style={{ width: "100%" }} data-testid="plan-view">
      <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} role="img" aria-label={`Plan, ${formatFeetInches(W)} by ${formatFeetInches(L)}`} style={{ margin: "0 auto" }}>
        <rect x={X(0)} y={Y(L)} width={W * s} height={L * s} fill="var(--card)" stroke="var(--ink)" strokeWidth={2} />
        {ordered.map((item) => {
          const { box, placement } = item;
          const w = box.width_mm * s;
          const d = box.depth_mm * s;
          const selected = item.id === selectedId;
          const stroke = item.flagged ? "var(--tag-red-text)" : selected ? "var(--signature)" : "var(--ink-2)";
          return (
            <g
              key={item.id}
              transform={`translate(${X(placement.x_mm)} ${Y(placement.y_mm)}) rotate(${-placement.rotation_deg})`}
              style={{ cursor: onMove ? "grab" : "default" }}
              onPointerDown={(e) => onPointerDown(e, item)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerEnter={() => setHoverId(item.id)}
              onPointerLeave={() => setHoverId((h) => (h === item.id ? null : h))}
              tabIndex={onSelect ? 0 : undefined}
              onKeyDown={(e) => e.key === "Enter" && onSelect?.(item.id)}
              onFocus={() => onSelect?.(item.id)}
              aria-label={item.title}
            >
              <clipPath id={`clip-${item.id}`}>
                <rect x={-w / 2} y={-d / 2} width={w} height={d} rx={2} />
              </clipPath>
              {item.image_url ? (
                <image href={item.image_url} x={-w / 2} y={-d / 2} width={w} height={d} preserveAspectRatio="xMidYMid slice" clipPath={`url(#clip-${item.id})`} opacity={item.kind === "soft_floor" ? 0.85 : 1} />
              ) : (
                <rect x={-w / 2} y={-d / 2} width={w} height={d} fill="var(--steel-1)" />
              )}
              <rect x={-w / 2} y={-d / 2} width={w} height={d} rx={2} fill="none" stroke={stroke} strokeWidth={item.flagged || selected ? 2.5 : 1.25} />
              {item.kind !== "soft_floor" && <line x1={-w / 2} y1={-d / 2} x2={w / 2} y2={-d / 2} stroke={stroke} strokeWidth={3} />}
              <title>{item.title}</title>
            </g>
          );
        })}
        {door && openingPath(door, "door")}
        {win && openingPath(win, "window")}
        {/* Dimension lines: width below the room, length to its right. */}
        <g stroke="var(--ink-3)" strokeWidth={1} fill="var(--ink-3)" fontSize={12} fontFamily="var(--font-mono)">
          <line x1={X(0)} y1={Y(0) + 24} x2={X(W)} y2={Y(0) + 24} />
          <line x1={X(0)} y1={Y(0) + 18} x2={X(0)} y2={Y(0) + 30} />
          <line x1={X(W)} y1={Y(0) + 18} x2={X(W)} y2={Y(0) + 30} />
          <text x={X(W / 2)} y={Y(0) + 42} textAnchor="middle" stroke="none">
            {formatFeetInches(W)}
          </text>
          <line x1={X(W) + 24} y1={Y(0)} x2={X(W) + 24} y2={Y(L)} />
          <line x1={X(W) + 18} y1={Y(0)} x2={X(W) + 30} y2={Y(0)} />
          <line x1={X(W) + 18} y1={Y(L)} x2={X(W) + 30} y2={Y(L)} />
          <text transform={`translate(${X(W) + 42} ${Y(L / 2)}) rotate(90)`} textAnchor="middle" stroke="none">
            {formatFeetInches(L)}
          </text>
        </g>
        {marks.map((m) => (
          <g key={m.key} pointerEvents="none" data-testid="rule-mark" data-relation={m.relation} data-result={m.pass ? "pass" : "fail"}>
            {m.targets.map((t, i) => (
              <line key={i} x1={X(m.subject.x_mm)} y1={Y(m.subject.y_mm)} x2={X(t.x_mm)} y2={Y(t.y_mm)} stroke={m.colour} strokeWidth={1.5} strokeDasharray={m.pass ? undefined : "5 3"} />
            ))}
            <circle cx={X(m.subject.x_mm)} cy={Y(m.subject.y_mm)} r={7} fill="var(--card)" stroke={m.colour} strokeWidth={1.5} />
            <text x={X(m.subject.x_mm)} y={Y(m.subject.y_mm) + 3.5} textAnchor="middle" fontSize={9} fontFamily="var(--font-mono)" fill={m.colour} stroke="none">
              {m.pass ? "✓" : "✗"}
            </text>
          </g>
        ))}
        {labels.map(({ k, mm, pa, pb }) => (
          <g key={k} pointerEvents="none">
            <line x1={X(pa.x_mm)} y1={Y(pa.y_mm)} x2={X(pb.x_mm)} y2={Y(pb.y_mm)} stroke="var(--annotate)" strokeWidth={1} strokeDasharray="4 3" />
            <rect x={X((pa.x_mm + pb.x_mm) / 2) - 28} y={Y((pa.y_mm + pb.y_mm) / 2) - 9} width={56} height={18} rx={4} fill="var(--card)" stroke="var(--annotate)" strokeWidth={1} />
            <text x={X((pa.x_mm + pb.x_mm) / 2)} y={Y((pa.y_mm + pb.y_mm) / 2) + 4} textAnchor="middle" fontSize={11} fontFamily="var(--font-mono)" fill="var(--annotate)">
              {formatFeetInches(mm)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
