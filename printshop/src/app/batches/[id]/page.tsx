import { Band } from "../../band";
import { BatchExperience } from "./experience";

/** Batch (PRD Section 7): the page a buyer's link opens; the record comes from GET /api/batches/:id on a poll.
 *  The link carries the buyer email that scopes the batch (issue #129), the same scope the MCP path reads. */
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ email?: string }> }) {
  return (
    <>
      <Band />
      <main className="sheet">
        <BatchExperience id={(await params).id} email={(await searchParams).email ?? ""} />
      </main>
    </>
  );
}
