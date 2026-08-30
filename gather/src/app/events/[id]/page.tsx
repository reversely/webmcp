import { notFound } from "next/navigation";
import { snapshot } from "../../../server/api";
import { Dashboard } from "./dashboard";

type Params = { params: Promise<{ id: string }> };

/** The published event: its dashboard (PRD Section 5). The Overview and Guest Experience tabs land with #89 and #94. */
export default async function Page({ params }: Params) {
  const { id } = await params;
  let initial;
  try {
    initial = snapshot(id);
  } catch {
    notFound();
  }
  return <Dashboard initial={initial} />;
}
