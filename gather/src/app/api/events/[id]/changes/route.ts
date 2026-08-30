import { NextResponse } from "next/server";
import { changes, errorResponse } from "../../../../../server/api";

type Params = { params: Promise<{ id: string }> };

/** `?since=<seq>` (get_changes): the change log after a sequence number. */
export async function GET(request: Request, { params }: Params) {
  try {
    const since = Number(new URL(request.url).searchParams.get("since") ?? "0");
    return NextResponse.json(changes((await params).id, Number.isNaN(since) ? 0 : since));
  } catch (e) {
    return errorResponse(e);
  }
}
