import { Landing } from "./landing";

/** The landing surface: create a project and get its code, or join one with a code (PRD 3.1 leaves accounts to a later version). */
export default async function Home({ searchParams }: { searchParams: Promise<{ missing?: string; code?: string; project?: string }> }) {
  const { missing, code, project } = await searchParams;
  return <Landing missingId={missing ?? null} initialCode={code ?? null} initialProjectId={project ?? null} />;
}
