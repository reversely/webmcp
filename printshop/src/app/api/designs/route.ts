import { NextResponse } from "next/server";
import { errorResponse, listDesigns } from "../../../server/api";

export async function GET(request: Request) {
  try {
    const u = new URL(request.url);
    const max = u.searchParams.get("max_unit_cents");
    return NextResponse.json({ designs: listDesigns({ format: u.searchParams.get("format") ?? undefined, max_unit_cents: max ? Number(max) : undefined }) });
  } catch (e) {
    return errorResponse(e);
  }
}
