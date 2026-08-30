import { NextResponse } from "next/server";
import { publishEvent } from "../../../../../domain/store";
import { errorResponse, requireEvent } from "../../../../../server/api";

type Params = { params: Promise<{ id: string }> };

/** Publishes the event and mints the invite code. */
export async function POST(_: Request, { params }: Params) {
  try {
    const event = publishEvent(requireEvent((await params).id).id);
    return NextResponse.json({ event, invite_path: `/i/${event.invite_code}` });
  } catch (e) {
    return errorResponse(e);
  }
}
