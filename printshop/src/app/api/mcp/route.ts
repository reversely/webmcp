import { NextResponse } from "next/server";
import { handleRpc, type RpcRequest } from "../../../server/mcp";

/** JSON-RPC over HTTP: initialize, tools/list, tools/call with meta.ucp-agent.profile (PRD Section 5). */
export async function POST(request: Request) {
  let rpc: RpcRequest;
  try {
    rpc = (await request.json()) as RpcRequest;
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "The body is not JSON" } }, { status: 400 });
  }
  return NextResponse.json(await handleRpc(rpc));
}
export async function GET() {
  return NextResponse.json({ endpoint: "/api/mcp", methods: ["initialize", "tools/list", "tools/call"], auth: "meta.ucp-agent.profile in every call" });
}
