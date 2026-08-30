import { NextResponse } from "next/server";
import { errorResponse } from "../../../../../server/api";
import { createToken, tokensFor } from "../../../../../server/mcp";

type Params = { params: Promise<{ id: string }> };

/** The organizer issues a token: holder, gifts, readable definitions, callable tools, expiry. The id is the secret. */
export async function POST(request: Request, { params }: Params) {
  try {
    return NextResponse.json(createToken((await params).id, await request.json()), { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function GET(_: Request, { params }: Params) {
  try {
    return NextResponse.json({ tokens: tokensFor((await params).id).map(({ id, ...rest }) => ({ ...rest, id: `${id.slice(0, 6)}...` })) });
  } catch (e) {
    return errorResponse(e);
  }
}
