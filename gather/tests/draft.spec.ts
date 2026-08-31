/** The draft page (PRD Section 5): the organizer fills the details, edits the questions, publishes, and lands on the event with its invite link. */
import { expect, test } from "@playwright/test";

test("a draft becomes a published event with the organizer's questions", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByTestId("publish")).toBeDisabled();
  await page.getByTestId("title").fill("Team offsite");
  await page.getByTestId("starts_at").fill("2030-01-10T19:00");
  await page.getByTestId("host").fill("A. Host");
  await page.getByTestId("venue_name").fill("Venue");
  await page.getByTestId("line1").fill("1 Street");
  await page.getByTestId("city").fill("City");
  await page.getByTestId("region").fill("RG");
  await page.getByTestId("postal_code").fill("00000");
  await page.getByTestId("country").fill("CA");
  await page.getByTestId("spots").fill("10");
  await page.getByTestId("cost").fill("10");
  await page.getByTestId("deadline").fill("2030-01-03");
  await page.getByTestId("needed_by").fill("2030-01-08");
  // The preview follows the fields.
  await expect(page.getByTestId("invite-preview")).toContainText("Team offsite");
  await expect(page.getByTestId("invite-preview")).toContainText("Hosted by A. Host");
  // A seeded multi-choice question starts with no choices; the organizer adds two in their words.
  const questions = page.getByTestId("questions");
  const choiceInput = questions.getByLabel(/Add a choice to/).first();
  await choiceInput.fill("Choice one");
  await choiceInput.press("Enter");
  await choiceInput.fill("No preference");
  await choiceInput.press("Enter");
  await expect(page.getByTestId("invite-preview")).toContainText("Choice one");
  // A question in the organizer's words joins the list.
  await page.getByLabel("A question in your words").fill("Anything else we should know?");
  await page.getByLabel("A question in your words").press("Enter");
  await expect(questions.getByRole("textbox", { name: "Question 3" })).toHaveValue("Anything else we should know?");

  await page.getByTestId("publish").click();
  await page.waitForURL(/\/events\/evt_/);
  await expect(page.getByTestId("status")).toHaveText("Published");
  await expect(page.getByTestId("invite-link")).toContainText(/\/i\/[A-Z0-9]{6}/);
  const id = page.url().split("/events/")[1];
  const snap = (await (await request.get(`/api/events/${id}`)).json()) as { definitions: { label: string; constraints: { options?: { label: string }[] } }[]; event: { status: string; cost_per_person_cents: number; delivery: { destination: string; needed_by: string } } };
  expect(snap.event).toMatchObject({ status: "published", cost_per_person_cents: 1000, delivery: { destination: "venue", needed_by: "2030-01-08" } });
  const multi = snap.definitions.find((d) => (d.constraints.options ?? []).length > 0)!;
  expect(multi.constraints.options!.map((o) => o.label)).toEqual(["Choice one", "No preference"]);
  expect(snap.definitions.map((d) => d.label)).toContain("Anything else we should know?");
});

test("a case variant of a choice is rejected so the value stays unique (#138)", async ({ page }) => {
  const warnings: string[] = [];
  page.on("console", (m) => { if (m.type() === "warning" || m.type() === "error") warnings.push(m.text()); });
  await page.goto("/");
  const questions = page.getByTestId("questions");
  const choiceInput = questions.getByLabel(/Add a choice to/).first();
  await choiceInput.fill("Choice one");
  await choiceInput.press("Enter");
  await choiceInput.fill("choice one");
  await choiceInput.press("Enter");
  // Both variants slug to choice_one; only the first is kept, so no duplicate React key.
  await expect(questions.getByRole("button", { name: /Remove choice one/i })).toHaveCount(1);
  await expect(page.getByTestId("invite-preview").getByText("choice one", { exact: false })).toHaveCount(1);
  expect(warnings.filter((w) => /same key|duplicate key/i.test(w))).toEqual([]);
});

test("publish waits for a required choice question to have options (#139)", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("title").fill("Team offsite");
  await page.getByTestId("starts_at").fill("2030-01-10T19:00");
  await page.getByTestId("city").fill("City");
  await page.getByTestId("country").fill("CA");
  // The seeded dietary question is required when going but ships with no options, so publish is blocked.
  await expect(page.getByTestId("publish-blocker")).toBeVisible();
  await expect(page.getByTestId("publish")).toBeDisabled();
  const choiceInput = page.getByTestId("questions").getByLabel(/Add a choice to/).first();
  await choiceInput.fill("No preference");
  await choiceInput.press("Enter");
  await expect(page.getByTestId("publish-blocker")).toHaveCount(0);
  await expect(page.getByTestId("publish")).toBeEnabled();
});
