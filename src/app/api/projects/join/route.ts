import { NextResponse } from "next/server";
import { appState, joinProject } from "../../../../server/state";

/**
 * Joins a project by room code. Body: { code, display_name, role }. The role is the person's own
 * word for their part in the project; nothing checks it. Returns { project_id, member_id, name }.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { code?: string; display_name?: string; role?: string };
  const code = body.code?.trim().toUpperCase() ?? "";
  const displayName = body.display_name?.trim() ?? "";
  if (code.length !== 6) return NextResponse.json({ error: "A room code has six letters or digits." }, { status: 400 });
  if (!displayName) return NextResponse.json({ error: "Enter the name the others will see." }, { status: 400 });
  const member = joinProject(code, displayName, body.role?.trim() ?? "");
  if (!member) return NextResponse.json({ error: `No project has the code ${code}. Check it with the person who created the project.` }, { status: 404 });
  const project = appState().store.getProject(member.project_id);
  return NextResponse.json({ project_id: member.project_id, member_id: member.id, display_name: member.display_name, role: member.role, name: project.name, code }, { status: 201 });
}
