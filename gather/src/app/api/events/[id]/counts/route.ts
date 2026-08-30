import { NextResponse } from "next/server";
import { BadRequestError, counts, errorResponse, readFilter } from "../../../../../server/api";

type Params = { params: Promise<{ id: string }> };

/** `?definition=def_2&filter=status:eq:going` (count_by). */
export async function GET(request: Request, { params }: Params) {
  try {
    const url = new URL(request.url);
    const definition = url.searchParams.get("definition");
    if (!definition) throw new BadRequestError("definition is required.");
    return NextResponse.json(counts((await params).id, definition, readFilter(url.searchParams.get("filter"))));
  } catch (e) {
    return errorResponse(e);
  }
}
