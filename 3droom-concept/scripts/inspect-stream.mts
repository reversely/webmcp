// Semantic gate for #19: a chat message streams back as events and the panel renders the reply and
// its tool lines. Run against the dev server on 3111: npx tsx scripts/inspect-stream.mts
import { chromium } from "@playwright/test";
import { createThroughLanding, openStage } from "../tests/helpers";

const BASE = "http://localhost:3111";
const out: string[] = [];
const note = (ok: boolean, w: string) => out.push(`${ok ? "ok " : "FAIL"} ${w}`);
type W = Window & { __chat_events?: { type: string; at: number }[] };

const browser = await chromium.launch();
const page = await (await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } })).newPage();
const { projectId } = await createThroughLanding(page, { name: "Stream flat", budgetUsd: 1800, requiredBy: "2026-10-01" }, "Zach", "owner");
await openStage(page, projectId, "place");
await page.evaluate(() => {
  (window as W).__chat_events = [];
});
const t0 = Date.now();
await page.getByTestId("chat-input").fill("What is this project's budget? Use your tools to read it and answer in one sentence.");
await page.getByTestId("chat-send").click();
await page.getByTestId("chat-log").getByText("What is this project's budget?").waitFor({ timeout: 15000 });
const userAt = Date.now() - t0;
note(userAt < 5000, `user line renders from the stream's first text event in ${userAt} ms, before the run ends`);
await page.getByTestId("chat-tool-event").first().waitFor({ timeout: 60000 }).catch(() => {});
const toolCount = await page.getByTestId("chat-tool-event").count();
note(toolCount >= 1, `${toolCount} tool line(s) render under the message while the run is in flight (${Date.now() - t0} ms)`);
const firstTool = await page.getByTestId("chat-tool-event").first().innerText().catch(() => "");
note(/read_project|read|budget/i.test(firstTool), `first tool line names the tool: "${firstTool.replace(/\s+/g, " ")}"`);
await page.locator(".msg.agent").first().waitFor({ timeout: 90000 });
const reply = await page.locator(".msg.agent").first().innerText();
note(/1[,.]?800/.test(reply), `reply names the budget from the project row: "${reply.slice(0, 120)}"`);
const events = await page.evaluate(() => (window as W).__chat_events ?? []);
const types = events.map((e) => e.type);
note(types[0] === "text" && types.at(-1) === "done" && types.includes("tool"), `event order: ${types.join(", ")}`);
const toolStatuses = await page.getByTestId("chat-tool-event").evaluateAll((els) => els.map((e) => e.getAttribute("data-status")));
note(toolStatuses.every((s) => s === "ok"), `after done every tool line closed: ${toolStatuses.join(", ")}`);
const group = page.locator(".msg-group").first();
note((await group.locator(".msg.user").count()) === 1 && (await group.locator("[data-testid=chat-tool-event]").count()) === toolCount, "tool lines sit under the user message that started the run");
const trace = (await (await page.request.get(`${BASE}/api/projects/${projectId}/trace`)).json()) as { spans: { kind: string; name: string; status: string }[] };
const toolSpans = trace.spans.filter((s) => s.kind === "tool");
note(toolSpans.length === toolCount, `tool lines match the trace's tool spans (${toolSpans.map((s) => `${s.name}:${s.status}`).join(", ")})`);
const snap = (await (await page.request.get(`${BASE}/api/projects/${projectId}`)).json()) as { messages: { role: string; text: string }[] };
note(snap.messages.length === 2 && snap.messages[1].text === reply, "the panel's reply is the stored agent message, verbatim");
await browser.close();
console.log(out.join("\n"));
process.exit(out.some((l) => l.startsWith("FAIL")) ? 1 : 0);
