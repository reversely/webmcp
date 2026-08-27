import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { appState, snapshot } from "../../../server/state";
import { StageNav } from "./stage-nav";
import { SidePanel } from "./side-panel";
import { WebMcpProvider } from "./webmcp-provider";

/**
 * The project frame (PRD 20): top bar with the four stages, the stage's centre surface, and the
 * BOM rail plus chat on the right. Stage 1 (board) takes the full width; later stages show the rail.
 */
export default async function ProjectLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = appState();
  if (!s.store.projects.has(id)) notFound();
  const snap = snapshot(id);
  return (
    <>
      <header className="topbar">
        <span className="brand">{snap.project.name}</span>
        <StageNav projectId={id} hasSpace={!!snap.space} hasRequirements={snap.requirements.length > 0} bomCount={snap.bom.filter((b) => b.status !== "removed").length} />
        <WebMcpProvider projectId={id} />
      </header>
      <SidePanel projectId={id}>{children}</SidePanel>
    </>
  );
}
