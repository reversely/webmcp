import { PreferencesStage } from "./preferences-stage";

/** Stage 1 (PRD 20): the tldraw whiteboard and the plan compiled from it. */
export default async function PreferencesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PreferencesStage projectId={id} />;
}
