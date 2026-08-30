/** The three pages (PRD Section 7): the cards, the live preview with the quote form, and the proof sheet with the thread; every rendered string is one clause with no comma. */
import { expect, test, type Page } from "@playwright/test";
import designs from "../src/data/designs.json" with { type: "json" };
import shop from "../src/data/shop.json" with { type: "json" };

const first = designs[0];
const needed = "2031-01-01";

/** Every text node and every placeholder or label attribute on the page; a comma in any of them fails the one-clause rule (PRD Section 2). */
async function strings(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const tag = n.parentElement?.tagName.toLowerCase();
      if (tag !== "script" && tag !== "style" && n.textContent?.trim()) out.push(n.textContent.trim());
    }
    for (const el of document.body.querySelectorAll("[placeholder],[aria-label],[title]")) {
      for (const a of ["placeholder", "aria-label", "title"]) { const v = el.getAttribute(a); if (v) out.push(v); }
    }
    return out;
  });
}
async function expectNoComma(page: Page) {
  const withComma = (await strings(page)).filter((s) => s.includes(","));
  expect(withComma, "strings with a comma").toEqual([]);
}

test("the Designs page lists one card per design row with format and paper and price from and lead time", async ({ page }) => {
  await page.goto("/");
  const cards = page.getByTestId("design");
  await expect(cards).toHaveCount(designs.length);
  for (const [i, d] of designs.entries()) {
    const card = cards.nth(i);
    await expect(card.getByTestId("design-format")).toContainText(d.format);
    await expect(card.getByTestId("design-paper")).toContainText(d.paper);
    const lowest = Math.min(...d.price_bands.map((b) => b.unit_cents));
    await expect(card.getByTestId("design-price")).toContainText(`from ${(lowest / 100).toFixed(2)} ${shop.currency}`);
    await expect(card.getByTestId("design-lead")).toContainText(`${d.lead_time_business_days} business days`);
    await expect(card).toHaveAttribute("href", `/designs/${d.id}`);
  }
  await expect(page.getByTestId("shop")).toContainText(shop.name);
  await expectNoComma(page);
});

test("the Design page's preview follows the typed name and the quote shows a total or the refusal's reason", async ({ page }) => {
  await page.goto(`/designs/${first.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(first.title);
  const nameField = first.fields.find((f) => f.kind === "name")!;
  await expect(page.getByTestId(`field-${nameField.key}`)).toHaveAttribute("maxlength", String(nameField.max_length));
  await page.getByTestId(`field-${nameField.key}`).fill("Ada Lovelace");
  await expect(page.getByTestId("preview").locator("svg")).toContainText("Ada Lovelace");
  await page.getByTestId("needed-by").fill(needed);
  await page.getByTestId("quantity").fill("1");
  await page.getByTestId("quote").click();
  await expect(page.getByTestId("quote-refusal")).toContainText(`Minimum ${first.minimum_quantity} units`);
  await page.getByTestId("quantity").fill(String(first.minimum_quantity));
  await page.getByTestId("quote").click();
  const unit = first.price_bands.filter((b) => first.minimum_quantity >= b.min_quantity).sort((a, b) => b.min_quantity - a.min_quantity)[0].unit_cents;
  const subtotal = unit * first.minimum_quantity;
  const total = subtotal + Math.round(subtotal * shop.tax_rate);
  await expect(page.getByTestId("quote-total")).toHaveText(`${(total / 100).toFixed(2)} ${shop.currency}`);
  await expectNoComma(page);
});

test("Add to batch opens the batch page where Order shows the proofs and Approve starts the clock and advance reaches the last stage", async ({ page }) => {
  await page.goto(`/designs/${first.id}`);
  const nameField = first.fields.find((f) => f.kind === "name")!;
  const lineField = first.fields.find((f) => f.key !== nameField.key);
  if (lineField) await page.getByTestId(`field-${lineField.key}`).fill("With thanks");
  await page.getByTestId("needed-by").fill(needed);
  await page.getByTestId("postal-code").fill("M5V 1A1");
  const names = Array.from({ length: first.minimum_quantity }, (_, i) => `Guest ${i + 1}`);
  await page.getByTestId("names").fill(names.join("\n"));
  await expect(page.getByTestId("unit-count")).toHaveText(`${names.length} units`);
  await page.getByTestId("buyer-name").fill("Buyer");
  await page.getByTestId("buyer-email").fill("buyer@example.com");
  await page.getByTestId("add-to-batch").click();
  await expect(page).toHaveURL(/\/batches\/batch_\d+$/);
  const id = page.url().split("/").pop()!;

  await expect(page.getByTestId("unit")).toHaveCount(names.length);
  if (lineField) await expect(page.getByTestId("units")).toContainText("With thanks");
  await expect(page.getByTestId("proof")).toHaveCount(0);
  await page.getByTestId("order").click();
  await expect(page.getByTestId("proof")).toHaveCount(names.length);
  await expect(page.getByTestId("proofs").locator("svg").first()).toContainText(names[0]);
  await expect(page.getByTestId("order")).toHaveCount(0);

  await page.getByTestId("message").fill("Please confirm the paper");
  await page.getByTestId("send-message").click();
  await expect(page.getByTestId("thread")).toContainText("Please confirm the paper");

  const before = await page.getByTestId("batch-status").textContent();
  await page.getByTestId("approve").click();
  await expect(page.getByTestId("batch-status")).not.toHaveText(before!);
  await expect(page.getByTestId("approve")).toHaveCount(0);
  const status = await page.getByTestId("batch-status").textContent();

  const last = shop.stages[shop.stages.length - 1];
  const at = new Date(Date.now() + (last.after_minutes + 1) * 60_000).toISOString();
  const advanced = await page.request.post(`/api/batches/${id}/advance`, { data: { at } });
  expect(advanced.ok()).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event("shop:changed")));
  await expect(page.getByTestId("batch-status")).toHaveText(last.status);
  expect(status).not.toBe(last.status);
  for (const stage of shop.stages) await expect(page.getByTestId("thread")).toContainText(stage.text);
  await expectNoComma(page);
});
