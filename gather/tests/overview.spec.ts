/** The Overview (PRD Section 5): counts, follow-ups, the guest table, and the editable setup, all from the polled snapshot. */
import { expect, test } from "@playwright/test";

test("the overview shows the replies as they arrive and edits the setup in place", async ({ page, request }) => {
  const created = await request.post("/api/events", { data: { title: "Test event", host: "Host", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" }, spots: 10, cost_per_person_cents: 1000, rsvp_deadline: "2030-01-03" } });
  const { id } = (await created.json()) as { id: string };
  const snap = (await (await request.get(`/api/events/${id}`)).json()) as { definitions: { id: string; key: string; value_type: string; label: string; scope: string; constraints: Record<string, unknown>; required_rule: string }[] };
  const defs = snap.definitions.map((d) => (d.value_type === "multi_enum" ? { ...d, constraints: { options: [{ value: "a", label: "Choice A" }, { value: "none", label: "None" }] } } : d));
  await request.put(`/api/events/${id}/definitions`, { data: { definitions: defs } });
  await request.post(`/api/events/${id}/publish`);
  const name = defs.find((d) => d.key === "printed_name")!.id;
  const dietary = defs.find((d) => d.key === "dietary")!.id;

  await page.goto(`/events/${id}`);
  await expect(page.getByTestId("event-title")).toHaveText("Test event");
  await expect(page.getByTestId("guests-empty")).toBeVisible();

  // Replies arrive through the API; the page follows within a poll.
  await request.post(`/api/events/${id}/rsvp`, { data: { guests: [{ display_name: "Guest One", status: "going", answers: { [name]: "One", [dietary]: ["a"] } }, { display_name: "Guest Two", status: "going", answers: { [dietary]: ["none"] } }, { display_name: "Guest Three", status: "maybe" }] } });
  await expect(page.getByTestId("stat-going").locator(".n")).toHaveText("2", { timeout: 8000 });
  await expect(page.getByTestId("stat-maybe").locator(".n")).toHaveText("1");
  await expect(page.getByTestId("guest-row")).toHaveCount(3);
  await expect(page.getByTestId("followups")).toContainText("1 guest going without name for printing");
  await expect(page.getByTestId("followups")).toContainText("1 guest still Maybe");
  await expect(page.getByTestId("replies-card")).toContainText("2 going");
  await expect(page.getByTestId("replies-card")).toContainText("Choice A");
  // A follow-up filters the table to its guests.
  await page.getByTestId("followups").getByRole("button", { name: "Show them" }).first().click();
  await expect(page.getByTestId("guest-row")).toHaveCount(1);
  await expect(page.getByTestId("guest-row")).toContainText("Guest Two");

  // The setup edits in place and the snapshot follows.
  await page.getByTestId("edit-setup").click();
  await page.locator("#s-title").fill("Test event, renamed");
  await page.getByTestId("save-setup").click();
  await expect(page.getByTestId("event-title")).toHaveText("Test event, renamed", { timeout: 8000 });
  await expect(page.getByTestId("invite-link")).toContainText(/\/i\/[A-Z0-9]{6}/);
});
