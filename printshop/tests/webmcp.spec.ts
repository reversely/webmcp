/** The shop's tools through Chrome's polyfill (PRD Section 9): the page lists them and a quote, a batch, and a proof run through them. */
import { expect, test, type Page } from "@playwright/test";

type Ctx = { getTools(): Promise<{ name: string }[]>; executeTool(tool: unknown, args: unknown): Promise<{ content: { text: string }[]; isError?: boolean }> };
async function execute(page: Page, name: string, args: Record<string, unknown>) {
  return page.evaluate(async ({ name, args }) => {
    const ctx = document.modelContext as unknown as Ctx;
    const tool = (await ctx.getTools()).find((t) => t.name === name);
    if (!tool) throw new Error(`Tool ${name} is not registered`);
    const r = await ctx.executeTool(tool, args);
    return { text: r.content[0]?.text ?? "", isError: r.isError === true };
  }, { name, args });
}

test("the page registers the eleven tools; a quote refuses below the minimum; a batch orders and proofs", async ({ page }) => {
  await page.goto("/?webmcp=polyfill");
  await expect(page.getByTestId("webmcp-status")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  const names = await page.evaluate(async () => (await document.modelContext!.getTools()).map((t) => t.name));
  expect(names).toHaveLength(11);
  const designs = JSON.parse((await execute(page, "list_designs", {})).text).designs as { id: string; minimum_quantity: number }[];
  expect(designs.length).toBeGreaterThan(0);
  const d = designs[0];
  const addr = { name: "Buyer", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" };
  const refused = await execute(page, "quote_batch", { design_id: d.id, quantity: 1, needed_by: "2031-01-01", address: addr });
  expect(refused.isError).toBe(true);
  expect(refused.text).toContain("minimum_quantity");
  const units = Array.from({ length: d.minimum_quantity }, (_, i) => ({ recipient_ref: `g${i}`, values: { name: `Guest ${i}` } }));
  const created = await execute(page, "create_batch", { design_id: d.id, units, address: addr, needed_by: "2031-01-01", buyer: { name: "Buyer", email: "buyer@example.com", phone: null } });
  expect(created.isError).toBe(false);
  const id = JSON.parse(created.text).id as string;
  const ordered = await execute(page, "order_batch", { batch_id: id });
  expect(JSON.parse(ordered.text).status).toBe("proofed");
  expect(JSON.parse(ordered.text).proof).toHaveLength(d.minimum_quantity);
});
