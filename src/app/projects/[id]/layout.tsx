import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { appState, projectCode, snapshot } from "../../../server/state";
import { ProjectPresence } from "./presence";
import { StageNav } from "./stage-nav";
import { SidePanel } from "./side-panel";
import { WebMcpProvider } from "./webmcp-provider";

/**
 * The project frame (PRD 20): top bar with the four stages, the room code, and who is here; the
 * stage's centre surface; and the BOM rail plus chat on the right. Stage 1 (board) takes the full
 * width; later stages show the rail. A project the server no longer holds (it restarted) sends the
 * visitor back to the landing page with a note.
 */
export default async function ProjectLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = appState();
  if (!s.store.projects.has(id)) redirect(`/?missing=${encodeURIComponent(id)}`);
  const snap = snapshot(id);
  return (
    <>
      <header className="topbar">
        <span className="brand">{snap.project.name}</span>
        <StageNav projectId={id} hasSpace={!!snap.space} hasRequirements={snap.requirements.length > 0} bomCount={snap.bom.filter((b) => b.status !== "removed").length} />
        <ProjectPresence projectId={id} code={projectCode(id)} />
        <WebMcpProvider projectId={id} />
      </header>
      <SidePanel projectId={id}>{children}</SidePanel>
    </>
  );
}
