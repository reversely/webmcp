import { NextResponse } from "next/server";
import { errorResponse, guestList, readFilter } from "../../../../../server/api";

type Params = { params: Promise<{ id: string }> };

/** `?filter=status:eq:going&fields=def_1,def_2` (PRD Section 7, list_guests). */
export async function GET(request: Request, { params }: Params) {
  try {
    const url = new URL(request.url);
    const fields = url.searchParams.get("fields")?.split(",").filter(Boolean);
    return NextResponse.json({ guests: guestList((await params).id, readFilter(url.searchParams.get("filter")), fields) });
  } catch (e) {
    return errorResponse(e);
  }
}
