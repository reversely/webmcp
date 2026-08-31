/** The invite (PRD Section 6): a guest replies, edits from the same link, and cancels. */
import { expect, test } from "@playwright/test";

async function publishedEvent(request: import("@playwright/test").APIRequestContext) {
  const created = await request.post("/api/events", { data: { title: "Test event", host: "Host", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" }, cost_per_person_cents: 1000, rsvp_deadline: "2030-01-03" } });
  const { id } = (await created.json()) as { id: string };
  const snap = (await (await request.get(`/api/events/${id}`)).json()) as { definitions: { key: string; label: string; scope: string; value_type: string; constraints: Record<string, unknown>; required_rule: string }[] };
  const defs = snap.definitions.map((d) => (d.value_type === "multi_enum" ? { ...d, constraints: { options: [{ value: "a", label: "Choice A" }, { value: "none", label: "None" }] } } : d));
  await request.put(`/api/events/${id}/definitions`, { data: { definitions: defs } });
  const published = (await (await request.post(`/api/events/${id}/publish`)).json()) as { event: { invite_code: string } };
  return { id, code: published.event.invite_code };
}

test("a guest replies going with answers, then edits, then cancels from the same link", async ({ page, request }) => {
  const { id, code } = await publishedEvent(request);
  await page.goto(`/i/${code}`);
  await expect(page.getByTestId("invite-title")).toHaveText("Test event");
  await expect(page.getByTestId("send")).toBeDisabled();
  await page.getByTestId("guest-name").fill("Guest One");
  await page.getByTestId("status").getByRole("button", { name: "Going" }).click();
  // Going makes the seeded questions required; the button waits for them.
  await expect(page.getByTestId("send")).toBeDisabled();
  await page.getByTestId("answer-printed_name").getByRole("textbox").fill("One");
  await page.getByTestId("answer-dietary").getByRole("button", { name: "Choice A" }).click();
  await page.getByTestId("send").click();
  await expect(page.getByTestId("saved")).toHaveText("Saved as Going");
  const url = page.url();
  expect(url).toMatch(/\?guest=guest_/);

  let snap = (await (await request.get(`/api/events/${id}`)).json()) as { guests: { display_name: string; status: string; values: Record<string, unknown> }[]; counts: Record<string, number> };
  expect(snap.guests[0]).toMatchObject({ display_name: "Guest One", status: "going" });
  expect(Object.values(snap.guests[0].values)).toEqual(expect.arrayContaining(["One", ["a"]]));

  // The same link reloads the reply and saves a change.
  await page.goto(url);
  await expect(page.getByTestId("guest-name")).toHaveValue("Guest One");
  await page.getByTestId("answer-printed_name").getByRole("textbox").fill("One R.");
  await page.getByTestId("send").click();
  await expect(page.getByTestId("saved")).toHaveText("Saved as Going");
  snap = (await (await request.get(`/api/events/${id}`)).json()) as typeof snap;
  expect(Object.values(snap.guests[0].values)).toContain("One R.");

  await page.getByTestId("cancel").click();
  await expect(page.getByTestId("saved")).toHaveText("Saved as Can't go");
  snap = (await (await request.get(`/api/events/${id}`)).json()) as typeof snap;
  expect(snap.guests[0].status).toBe("cant_go");
  expect(snap.counts.cant_go).toBe(1);
});

test("an unknown code is a 404", async ({ page }) => {
  const res = await page.goto("/i/ZZZZZZ");
  expect(res?.status()).toBe(404);
});

test("a bogus guest id blocks the form and names the unknown link (#145)", async ({ page, request }) => {
  const { code } = await publishedEvent(request);
  await page.goto(`/i/${code}?guest=guest_bogus`);
  await expect(page.getByTestId("bad-link")).toHaveText("Unknown reply link");
  // No form renders, so a reply cannot be filed.
  await expect(page.getByTestId("guest-name")).toHaveCount(0);
  await expect(page.getByTestId("send")).toHaveCount(0);
});
