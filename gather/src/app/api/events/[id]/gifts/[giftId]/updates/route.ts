import { NextResponse } from "next/server";
import { errorResponse, postUpdate, updatesFor } from "../../../../../../../server/api";

type Params = { params: Promise<{ id: string; giftId: string }> };

/** The thread for one gift (get_updates). */
export async function GET(request: Request, { params }: Params) {
  try {
    const { id, giftId } = await params;
    const since = Number(new URL(request.url).searchParams.get("since") ?? "0");
    return NextResponse.json({ updates: updatesFor(id, giftId, Number.isNaN(since) ? 0 : since) });
  } catch (e) {
    return errorResponse(e);
  }
}

/** A post from the organizer (kind reply, or any kind when Gather writes a Shopify status). The MCP endpoint posts for vendors with their token as caller. */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id, giftId } = await params;
    const body = (await request.json()) as { caller?: string };
    return NextResponse.json(postUpdate(id, giftId, body.caller ?? "organizer", body), { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
