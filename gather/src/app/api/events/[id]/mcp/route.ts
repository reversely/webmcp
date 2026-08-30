import { NextResponse } from "next/server";
import { handleRpc, tokenFrom, type RpcRequest } from "../../../../../server/mcp";

type Params = { params: Promise<{ id: string }> };

/** JSON-RPC over HTTP: initialize, tools/list, tools/call, with `Authorization: Bearer <token id>` (PRD Section 8). */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  let rpc: RpcRequest;
  try {
    rpc = (await request.json()) as RpcRequest;
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "The body is not JSON." } }, { status: 400 });
  }
  return NextResponse.json(await handleRpc(id, tokenFrom(id, request), rpc));
}

/** A GET names the endpoint for a person who opens the address in a browser. */
export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  return NextResponse.json({ endpoint: `/api/events/${id}/mcp`, methods: ["initialize", "tools/list", "tools/call"], auth: "Authorization: Bearer <token id>" });
}
