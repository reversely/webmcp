/** One proof per unit as SVG from the design's template row and the unit's values (PRD Section 6, step 4). */
import type { Design, Unit } from "./types";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderProof(design: Design, unit: Unit): string {
  const t = design.template;
  const name = unit.values.name ?? "";
  const line = unit.values.line ?? unit.values.monogram ?? "";
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${t.width}" height="${t.height}" viewBox="0 0 ${t.width} ${t.height}" role="img" aria-label="${esc(design.title)} for ${esc(name)}">`,
    `<rect width="100%" height="100%" fill="${t.background}"/>`,
    t.heading ? `<text x="50%" y="${Math.round(t.height * 0.32)}" text-anchor="middle" font-family="Zilla Slab, serif" font-size="${Math.round(t.width * 0.11)}" fill="${t.ink}">${esc(t.heading)}</text>` : "",
    `<text x="50%" y="${t.name_y}" text-anchor="middle" font-family="Inter, sans-serif" font-size="${Math.round(t.width * 0.07)}" fill="${t.ink}">${esc(name)}</text>`,
    line ? `<text x="50%" y="${t.line_y}" text-anchor="middle" font-family="Inter, sans-serif" font-size="${Math.round(t.width * 0.04)}" fill="${t.ink}" opacity="0.8">${esc(line)}</text>` : "",
    `</svg>`
  ];
  return parts.filter(Boolean).join("");
}
