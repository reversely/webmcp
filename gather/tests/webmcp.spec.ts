/**
 * Gather's tools through Chrome's polyfill (PRD Section 12): Playwright's Chromium has no native
 * `document.modelContext`, so the dashboard opens with `?webmcp=polyfill`.
 */
import { expect, test, type Page } from "@playwright/test";

type Ctx = { getTools(): Promise<{ name: string }[]>; executeTool(tool: unknown, args: unknown): Promise<{ content: { text: string }[]; isError?: boolean }> };
async function execute(page: Page, name: string, args: Record<string, unknown>) {
  return page.evaluate(
    async ({ name, args }) => {
      const ctx = document.modelContext as unknown as Ctx;
      const tool = (await ctx.getTools()).find((t) => t.name === name);
      if (!tool) throw new Error(`Tool ${name} is not registered`);
      const result = await ctx.executeTool(tool, args);
      return { text: result.content[0]?.text ?? "", isError: result.isError === true };
    },
    { name, args }
  );
}

test("the dashboard registers the organizer's tools; get_summary reads the seeded counts; a foreign write is an error", async ({ page, request }) => {
  const created = await request.post("/api/events", { data: { title: "Test event", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" } } });
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/events/${id}/publish`);
  await request.post(`/api/events/${id}/rsvp`, { data: { guests: [{ display_name: "Guest One", status: "going" }, { display_name: "Guest Two", status: "maybe" }] } });

  await page.goto(`/events/${id}?webmcp=polyfill`);
  await expect(page.getByTestId("webmcp-status")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  const names = await page.evaluate(async () => (await document.modelContext!.getTools()).map((t) => t.name).sort());
  expect(names).toEqual(["approve", "count_by", "get_changes", "get_guest", "get_manifest", "get_summary", "get_updates", "list_guests", "list_missing", "post_update", "search_gifts", "send_to_vendor", "set_gift_plan"]);

  const summary = await execute(page, "get_summary", { filter: "" });
  expect(summary.isError).toBe(false);
  expect(JSON.parse(summary.text).status).toEqual({ going: 1, maybe: 1, cant_go: 0, no_reply: 0 });

  const going = await execute(page, "list_guests", { filter: "status:eq:going" });
  expect(JSON.parse(going.text).guests.map((g: { display_name: string }) => g.display_name)).toEqual(["Guest One"]);

  const posted = await execute(page, "post_update", { gift_id: "gift_x", kind: "reply", text: "A note." });
  expect(posted.isError).toBe(false);
  const thread = await execute(page, "get_updates", { gift_id: "gift_x" });
  expect(JSON.parse(thread.text).updates).toHaveLength(1);

  const foreign = await execute(page, "get_guest", { guest_id: "guest_none" });
  expect(foreign.isError).toBe(true);
});
