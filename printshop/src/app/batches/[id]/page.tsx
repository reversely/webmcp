import { Band } from "../../band";
import { BatchExperience } from "./experience";

/** Batch (PRD Section 7): the page a buyer's link opens; the record comes from GET /api/batches/:id on a poll. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <>
      <Band />
      <main className="sheet">
        <BatchExperience id={(await params).id} />
      </main>
    </>
  );
}
