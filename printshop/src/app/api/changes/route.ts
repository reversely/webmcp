import { NextResponse } from "next/server";
import { changes, errorResponse } from "../../../server/api";

export async function GET(request: Request) {
  try {
    const since = Number(new URL(request.url).searchParams.get("since") ?? "0");
    return NextResponse.json(changes(Number.isNaN(since) ? 0 : since, null));
  } catch (e) {
    return errorResponse(e);
  }
}
