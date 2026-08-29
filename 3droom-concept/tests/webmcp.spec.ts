/**
 * WebMCP integration tests (PRD 23, issue #31).
 *
 * Playwright's bundled Chromium has no native `document.modelContext`, so each page opens with
 * `?webmcp=polyfill` and the provider loads Chrome's polyfill before registering. The Chrome
 * Canary switch behind chrome://flags/#enable-webmcp-testing is not needed on this path; a run
 * against a native build would drop the query flag and pass a `channel` in playwright.config.ts.
 *
 * The suite creates a disposable project per run. The API has no DELETE route yet, so the project
 * stays in the dev server's in-memory state until the server restarts.
 */
import { expect, test } from "@playwright/test";
import { createProject, executeTool, openStage, waitForTools } from "./helpers";

const TOOL_NAMES = ["get_project_state", "add_product", "set_project_requirement", "update_bom", "replace_bom_item", "place_product", "evaluate_project"];

test.describe("WebMCP tools on the project page", () => {
  let projectId: string;

  test.beforeAll(async ({ request }) => {
    projectId = (await createProject(request, `WebMCP integration ${Date.now()}`)).project.id;
  });

  test("getTools lists the seven planner tools", async ({ page }) => {
    await openStage(page, projectId, "room");
    await waitForTools(page);
    await expect(page.getByTestId("webmcp-status")).toHaveText("Agent tools ready");
    const names = await page.evaluate(async () => (await document.modelContext!.getTools()).map((t) => t.name).sort());
    expect(names).toEqual([...TOOL_NAMES].sort());
  });

  test("get_project_state returns the project id and budget", async ({ page }) => {
    await openStage(page, projectId, "room");
    await waitForTools(page);
    const result = await executeTool(page, "get_project_state");
    expect(result.isError).toBe(false);
    const state = result.json as { project_id: string; budget: { limit_cents: number; committed_cents: number; state: string } };
    expect(state.project_id).toBe(projectId);
    expect(state.budget.limit_cents).toBe(250000);
    expect(state.budget.committed_cents).toBe(0);
    expect(state.budget.state).toBe("under");
  });

  test("set_project_requirement budget 260000 changes the rail", async ({ page }) => {
    await openStage(page, projectId, "room");
    await waitForTools(page);
    await expect(page.getByTestId("budget-stat")).toContainText("$2,500");
    const result = await executeTool(page, "set_project_requirement", { type: "budget", value: 260000 });
    expect(result.isError).toBe(false);
    expect((result.json as { budget: { limit_cents: number } }).budget.limit_cents).toBe(260000);
    await expect(page.getByTestId("budget-stat")).toContainText("$2,600");
  });

  test("a write against a foreign project id is an error and changes nothing", async ({ page, request }) => {
    await openStage(page, projectId, "room");
    await waitForTools(page);
    const result = await page.evaluate(async () => {
      type Ctx = { getTools(): Promise<{ name: string }[]>; executeTool(tool: unknown, args: unknown): Promise<{ isError?: boolean }> };
      const ctx = document.modelContext as unknown as Ctx;
      const tool = (await ctx.getTools()).find((t) => t.name === "update_bom")!;
      return ctx.executeTool(tool, { bomItemId: "bom_from_another_project", action: "approve" });
    });
    expect(result.isError).toBe(true);
    const snap = await (await request.get(`/api/projects/${projectId}`)).json();
    expect(snap.bom).toEqual([]);
  });
});
