"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useIdentity } from "../../identity";
import { localCursor, setPresenceMembers, type PresenceMember } from "./board/presence-store";

const HEARTBEAT_MS = 5000;
/** A chip dims after this long without a heartbeat: three missed beats. */
const AWAY_MS = 15000;

type MemberChip = PresenceMember;

/**
 * The code (copyable) and who is in the project. The client heartbeats its stage and, on the
 * board, its pointer every 5 s and re-reads the member list on the same beat (#18: the board draws
 * the others' cursors from that list); a 404 from either call means the server restarted and
 * forgot the project, so the browser goes back to the landing page with a note.
 */
export function ProjectPresence({ projectId, code }: { projectId: string; code: string | null }) {
  const pathname = usePathname();
  const identity = useIdentity(projectId);
  const [members, setMembers] = useState<MemberChip[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const stage = pathname.split("/").pop() ?? null;

  useEffect(() => {
    let stopped = false;
    const leave = () => window.location.assign(`/?missing=${encodeURIComponent(projectId)}`);
    async function beat() {
      try {
        if (identity) {
          const res = await fetch(`/api/projects/${projectId}/presence`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ member_id: identity.member_id, stage, cursor: localCursor() }) });
          if (res.status === 404) return leave();
        }
        const res = await fetch(`/api/projects/${projectId}/members`, { cache: "no-store" });
        if (res.status === 404) return leave();
        if (res.ok && !stopped) {
          const body = (await res.json()) as { members: MemberChip[]; now: string };
          setMembers(body.members);
          setPresenceMembers(body.members);
          setNow(Date.parse(body.now));
        }
      } catch {
        // A dropped beat is not an error; the next one is five seconds away.
      }
    }
    beat();
    const t = setInterval(beat, HEARTBEAT_MS);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [projectId, identity, stage]);

  async function copy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access denied: the code is still selectable in the button label.
    }
  }

  return (
    <div className="presence-bar">
      {code && (
        <button type="button" className="code-chip" onClick={copy} title="Copy the room code" data-testid="project-code">
          <span className="mono-code">{code}</span>
          <span className="code-hint">{copied ? "Copied" : "Copy"}</span>
        </button>
      )}
      <div className="presence" data-testid="presence" aria-label="People in this project">
        {members.map((m) => {
          const active = now - Date.parse(m.last_seen) <= AWAY_MS;
          const me = identity?.member_id === m.id;
          return (
            <span key={m.id} className={`member-chip${active ? "" : " away"}`} data-testid="presence-member" data-member-id={m.id} data-active={active} title={m.stage ? `On the ${m.stage} stage` : undefined}>
              <span className="member-dot" />
              {m.display_name}
              {m.role && <span className="member-role">{m.role}</span>}
              {me && <span className="member-role">you</span>}
            </span>
          );
        })}
        {identity === null && code && (
          <Link className="member-chip join" href={`/?code=${code}&project=${projectId}`} data-testid="presence-join">
            Join this project
          </Link>
        )}
      </div>
    </div>
  );
}
