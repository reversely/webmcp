import { notFound } from "next/navigation";
import { readyBy } from "../../../domain/quote";
import { getDesign, shop } from "../../../domain/store";
import { Band } from "../../band";
import { DesignExperience } from "./experience";

/** Design (PRD Section 7): the row's details and the schema as a form with a live preview and a quote form and Add to batch. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const design = getDesign((await params).id);
  if (!design) notFound();
  const earliest = readyBy(design, new Date().toISOString().slice(0, 10));
  return (
    <>
      <Band />
      <main className="sheet">
        <DesignExperience design={design} shop={shop()} earliest={earliest} />
      </main>
    </>
  );
}
