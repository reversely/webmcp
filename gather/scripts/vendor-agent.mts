/**
 * A vendor's agent, scripted (PRD Sections 4 and 8): holds a token for one gift, reads the manifest
 * and the change feed from Gather's MCP endpoint, and posts what a vendor posts: a confirmation
 * with an expected date, then a shipped notice with a reference. In the demo this plays the vendor
 * with an agent of its own. Nothing here spends money; the token cannot.
 *
 * Run: npx tsx gather/scripts/vendor-agent.mts <base url> <event id> <token id> <gift id> [confirm|ship|watch]
 * Each step is one JSON-RPC call; the script prints the calls and the replies.
 */
const [base, eventId, token, giftId, step = "confirm"] = process.argv.slice(2);
if (!base || !eventId || !token || !giftId) {
  console.error("usage: vendor-agent.mts <base url> <event id> <token id> <gift id> [confirm|ship|watch]");
  process.exit(2);
}
const PROFILE = "https://shopify.dev/ucp/agent-profiles/2026-04-08/valid-with-capabilities.json";

async function call(name: string, args: Record<string, unknown>): Promise<{ payload: Record<string, unknown> | null; isError: boolean; seq?: number }> {
  const res = await fetch(`${base}/api/events/${eventId}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: { ...args, meta: { "ucp-agent": { profile: PROFILE } } } } }) });
  const body = (await res.json()) as { result?: { content: { text: string }[]; isError?: boolean; seq?: number }; error?: { message: string } };
  if (body.error) return { payload: { error: body.error.message }, isError: true };
  const text = body.result?.content?.[0]?.text ?? "null";
  console.log(`> ${name} ${JSON.stringify(args)}\n< ${text.slice(0, 300)}${text.length > 300 ? "..." : ""}`);
  return { payload: JSON.parse(text), isError: body.result?.isError === true, seq: body.result?.seq };
}

const list = await fetch(`${base}/api/events/${eventId}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "tools/list" }) }).then((r) => r.json() as Promise<{ result?: { tools: { name: string }[] } }>);
const tools = list.result?.tools.map((t) => t.name) ?? [];
console.log(`tools for this token: ${tools.join(", ")}`);
const changes = await call("get_changes", { since_seq: 0 });
const manifest = await call("get_manifest", { gift_id: giftId });
if (manifest.isError) process.exit(1);
const rows = (manifest.payload?.rows as { unit_status: string; variant_id: string | null }[]) ?? [];
const units = rows.filter((r) => ["open", "locked"].includes(r.unit_status)).length;
console.log(`${rows.length} rows, ${units} units to produce`);

if (step === "confirm") {
  const expected = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  await call("post_update", { gift_id: giftId, kind: "confirmed", text: `Confirmed ${units} units; expected ready by ${expected}.`, expected_date: expected });
} else if (step === "ship") {
  await call("post_update", { gift_id: giftId, kind: "shipped", text: `${units} units shipped.`, reference: `REF-${Date.now().toString(36).toUpperCase()}` });
} else if (step === "watch") {
  let since = changes.seq ?? 0;
  for (let i = 0; i < 30; i++) {
    const next = await call("get_changes", { since_seq: since });
    const entries = (next.payload?.entries as { kind: string; seq: number }[]) ?? [];
    for (const e of entries) console.log(`  change ${e.seq}: ${e.kind}`);
    since = next.seq ?? since;
    await new Promise((r) => setTimeout(r, 4000));
  }
}
