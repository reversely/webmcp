import { snapshot } from "../../../../server/state";
import { CatalogTable } from "./catalog-table";

export default async function CatalogPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const snap = snapshot(id);
  return (
    <>
      <h1 className="page-title">Catalog</h1>
      <p className="page-summary">Every product this project has ingested, with the dimensions it was read with and where they came from.</p>
      <CatalogTable projectId={id} products={snap.products} candidates={snap.candidates} />
    </>
  );
}
