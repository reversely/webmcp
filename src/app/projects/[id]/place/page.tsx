import Link from "next/link";
import { snapshot } from "../../../../server/state";
import { ItemsStage } from "./items-stage";

export default async function ItemsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const snap = snapshot(id);
  if (!snap.space) {
    return (
      <>
        <h1 className="page-title">Items</h1>
        <p className="page-summary">Placing furniture needs a room. Confirm the room on the previous stage first.</p>
        <Link className="btn primary" href={`/projects/${id}/room`} style={{ display: "inline-flex", alignItems: "center" }}>
          Go to Room
        </Link>
      </>
    );
  }
  return <ItemsStage projectId={id} initial={snap} />;
}
