import { redirect } from "next/navigation";
import { appState } from "../server/state";

/** Creates the demo project on first visit and sends the visitor into stage 1. */
export default async function Home() {
  const s = appState();
  let id = [...s.store.projects.keys()][0];
  if (!id) {
    id = s.store.newId("proj");
    s.store.insertProject({
      id,
      name: "Zach + Ben Living Room",
      budget_cents: 250000,
      currency: "USD",
      required_by: "2026-09-15",
      delivery_address_json: null,
      created_at: new Date().toISOString()
    });
  }
  redirect(`/projects/${id}/board`);
}
