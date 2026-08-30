/**
 * The template's WebMCP tools through Chrome's polyfill: Playwright's Chromium has no native
 * `document.modelContext`, so the page opens with `?webmcp=polyfill`.
 */
import { expect, test } from "@playwright/test";

type Ctx = { getTools(): Promise<{ name: string }[]>; executeTool(tool: unknown, args: unknown): Promise<{ content: { text: string }[]; isError?: boolean }> };

async function execute(page: import("@playwright/test").Page, name: string, args: Record<string, unknown>) {
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

test("the page registers add_note and list_notes, and a tool call shows on the page", async ({ page }) => {
  await page.goto("/?webmcp=polyfill");
  await expect(page.getByTestId("webmcp-status")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  const names = await page.evaluate(async () => (await document.modelContext!.getTools()).map((t) => t.name).sort());
  expect(names).toEqual(["add_note", "list_notes"]);

  const added = await execute(page, "add_note", { text: "measure the window" });
  expect(added.isError).toBe(false);
  await expect(page.getByTestId("note")).toHaveText(["measure the window"]);

  const listed = await execute(page, "list_notes", {});
  expect(JSON.parse(listed.text)).toHaveLength(1);

  const empty = await execute(page, "add_note", { text: "  " });
  expect(empty.isError).toBe(true);
});
