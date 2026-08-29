/**
 * PRD 17 failure rows that need a browser (#33): a server restart seen through a stale identity,
 * WebMCP unavailable, and the two rows whose visible outcome is a tag in the tray and an issue in
 * the trace drawer (a product without dimensions, a dead image URL). The Node rows live in
 * src/agent/failures.test.ts. Runs against the dev server on 3111 with a disposable project; no
 * model call is made, so it needs no key.
 */
import { expect, test, type APIRequestContext } from "@playwright/test";
import { createProject, openStage, POLYFILL } from "./helpers";

test.use({ video: "off" });

/** A catalog-shaped product for the disposable project; `.invalid` never resolves, so its image is dead by construction. */
function catalogProduct(title: string, index: number, techSpecs: string | null) {
  const domain = "fault-injection.invalid";
  return {
    id: `gid://shopify/Product/fault-${index}`,
    title,
    description: { plain: "A fixture for the failure suite." },
    url: `https://${domain}/products/fault-${index}`,
    ...(techSpecs ? { metadata: { tech_specs: techSpecs } } : {}),
    media: [{ url: `https://${domain}/images/fault-${index}.jpg` }],
    variants: [{ id: `gid://shopify/ProductVariant/fault-${index}`, price: { amount: 12900, currency: "USD" }, availability: { available: true }, seller: { domain, name: "Fault fixture" } }]
  };
}

async function addProduct(request: APIRequestContext, projectId: string, category: string, title: string, index: number, techSpecs: string | null) {
  const res = await request.post(`/api/projects/${projectId}/products`, { data: { catalog: catalogProduct(title, index, techSpecs), category, kind: "other" } });
  expect(res.status()).toBe(201);
}

async function issues(request: APIRequestContext, projectId: string): Promise<{ source: string; message: string; severity: string }[]> {
  const res = await request.get(`/api/projects/${projectId}/trace?since=0`);
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { issues: { source: string; message: string; severity: string }[] }).issues;
}

test.describe("PRD 17 in the browser", () => {
  let projectId: string;

  test.beforeAll(async ({ request }) => {
    projectId = (await createProject(request, `Failure suite ${Date.now()}`)).project.id;
  });

  test("a stale identity after a server restart sends the browser to the landing page with a note naming the project", async ({ page }) => {
    // The member row lives only in server memory, so a restart forgets it while the browser still holds it.
    await page.addInitScript((id) => {
      window.localStorage.setItem(`planner:identity:${id}`, JSON.stringify({ member_id: "mem_from_before_the_restart", display_name: "Zach", role: "buyer", project_id: id }));
    }, projectId);
    await page.goto(`/projects/${projectId}/board${POLYFILL}`);
    await page.waitForURL((url) => url.pathname === "/" && url.searchParams.get("missing") === projectId, { timeout: 15_000 });
    const note = page.getByTestId("landing-message");
    await expect(note).toBeVisible();
    await expect(note).toContainText(`The project you were in (${projectId}) is no longer on the server`);
    await expect(page.getByTestId("create-name")).toBeVisible();
  });

  test("a project that the server no longer has redirects the same way", async ({ page }) => {
    await page.goto(`/projects/proj_gone_after_restart/room${POLYFILL}`);
    await page.waitForURL((url) => url.pathname === "/" && url.searchParams.get("missing") === "proj_gone_after_restart");
    await expect(page.getByTestId("landing-message")).toContainText("proj_gone_after_restart");
  });

  test("without WebMCP the tag says so and the page works in full", async ({ page }) => {
    // No polyfill flag: Playwright's Chromium has no document.modelContext, as an ordinary browser today.
    await page.goto(`/projects/${projectId}/room`);
    await expect(page.getByTestId("stage-nav")).toBeVisible();
    const tag = page.getByTestId("webmcp-status");
    await expect(tag).toHaveAttribute("data-status", "unavailable", { timeout: 20_000 });
    await expect(tag).toHaveText("Agent tools unavailable in this browser");
    expect(await page.evaluate(() => "modelContext" in document && document.modelContext !== undefined)).toBe(false);

    // Manual surfaces still respond: the chat box takes input, the trace drawer opens, the stages navigate.
    const input = page.getByTestId("chat-input");
    await expect(input).toBeEditable();
    await input.fill("typed without agent tools");
    await expect(input).toHaveValue("typed without agent tools");
    await page.getByTestId("trace-toggle").click();
    await expect(page.getByTestId("trace-panel")).toHaveAttribute("data-open", "true");
    await expect(page.getByTestId("issues-panel")).toBeVisible();
    for (const stage of ["catalog", "place", "board"] as const) {
      await openStage(page, projectId, stage);
      await expect(page.getByTestId("webmcp-status")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
    }
  });

  test("a product without dimensions is tagged in the tray and excluded from the geometry; a dead image URL lands its 3D job as proxy with an issue", async ({ page, request }) => {
    await addProduct(request, projectId, "fixture with no size", "Fault fixture without dimensions", 1, null);
    await addProduct(request, projectId, "fixture with a dead image", "Fault fixture with a dead image", 2, '40" W x 20" D x 30" H');

    const snapshot = (await (await request.get(`/api/projects/${projectId}`)).json()) as { products: { title: string; spatial_status: string; width_mm: number | null }[]; placements: unknown[] };
    const noDims = snapshot.products.find((p) => p.title === "Fault fixture without dimensions")!;
    expect(noDims.spatial_status).toBe("visual_only");
    expect(noDims.width_mm).toBeNull();

    await openStage(page, projectId, "room");
    const line = page.locator(".rail-line", { hasText: "Fault fixture without dimensions" });
    await expect(line).toBeVisible();
    await expect(line).toContainText("dimensions unknown");
    const sized = page.locator(".rail-line", { hasText: "Fault fixture with a dead image" });
    await expect(sized).toContainText(`3' 4" × 1' 8"`);

    // The image host never resolves, so the job settles at proxy within the image timeout.
    await expect
      .poll(async () => (await issues(request, projectId)).filter((i) => i.source === "three_d request_model").map((i) => i.message), { timeout: 40_000 })
      .toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^3D generation for "Fault fixture without dimensions" fell back to a proxy box \(product has no width, depth, and height\); the room shows its dimensions without the modelled shape\.$/),
          expect.stringMatching(/^3D generation for "Fault fixture with a dead image" fell back to a proxy box \(.+\); the room shows its dimensions without the modelled shape\.$/)
        ])
      );
    const after = (await (await request.get(`/api/projects/${projectId}`)).json()) as { products: { title: string; model_status: string; glb_url: string | null }[]; model_jobs?: Record<string, { status: string; stages: { name: string; detail?: string }[] }> };
    for (const title of ["Fault fixture without dimensions", "Fault fixture with a dead image"]) {
      expect(after.products.find((p) => p.title === title)).toMatchObject({ model_status: "proxy", glb_url: null });
    }
    // The issues strip shows both sentences newest first.
    await page.getByTestId("trace-toggle").click();
    const strip = page.getByTestId("issues-panel");
    await expect(strip).toContainText('3D generation for "Fault fixture with a dead image" fell back to a proxy box', { timeout: 10_000 });
    await expect(strip).toContainText("product has no width, depth, and height");
  });
});
