"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const STAGES = [
  { slug: "board", label: "Preferences" },
  { slug: "room", label: "Room" },
  { slug: "place", label: "Items" },
  { slug: "catalog", label: "Catalog" }
] as const;

export function StageNav({ projectId, hasSpace, hasRequirements, bomCount }: { projectId: string; hasSpace: boolean; hasRequirements: boolean; bomCount: number }) {
  const pathname = usePathname();
  const done: Record<string, boolean> = { board: hasRequirements, room: hasSpace, place: bomCount > 0, catalog: false };
  return (
    <nav className="stages" aria-label="Stages">
      {STAGES.map((stage, i) => {
        const href = `/projects/${projectId}/${stage.slug}`;
        const current = pathname === href;
        return (
          <Link key={stage.slug} href={href} className={`stage${done[stage.slug] && !current ? " done" : ""}`} aria-current={current ? "page" : undefined}>
            <span className="n">{i + 1}</span>
            {stage.label}
          </Link>
        );
      })}
    </nav>
  );
}
