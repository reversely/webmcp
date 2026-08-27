"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { saveIdentity } from "./identity";
import styles from "./landing.module.css";

type Created = { id: string; code: string; name: string };

/** Keeps the WebMCP polyfill flag on the URL when the landing page was opened with it (tests do). */
function boardUrl(projectId: string): string {
  const flag = new URLSearchParams(window.location.search).get("webmcp");
  return `/projects/${projectId}/board${flag ? `?webmcp=${flag}` : ""}`;
}

/**
 * Name and role, shared by the join card and the post-create step. The role is the person's own
 * word; when the project already has members, their roles are listed so a newcomer can avoid a
 * duplicate.
 */
function WhoAmI({ name, role, onName, onRole, idPrefix, takenRoles = [] }: { name: string; role: string; onName: (v: string) => void; onRole: (v: string) => void; idPrefix: string; takenRoles?: string[] }) {
  return (
    <>
      <div className="field">
        <label htmlFor={`${idPrefix}-name`}>Your name as the others will see it</label>
        <input id={`${idPrefix}-name`} className="input" value={name} onChange={(e) => onName(e.target.value)} autoComplete="name" data-testid={`${idPrefix}-name`} required />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-role`}>Your role in the project</label>
        <input id={`${idPrefix}-role`} className="input" value={role} onChange={(e) => onRole(e.target.value)} data-testid={`${idPrefix}-role`} />
        {takenRoles.length > 0 && <p className={styles.taken}>Already in the project: {takenRoles.join(", ")}.</p>}
      </div>
    </>
  );
}

async function join(code: string, displayName: string, role: string): Promise<{ project_id: string; member_id: string } | { error: string }> {
  const res = await fetch("/api/projects/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, display_name: displayName, role }) });
  const body = (await res.json()) as { project_id?: string; member_id?: string; error?: string };
  if (!res.ok || !body.project_id || !body.member_id) return { error: body.error ?? `Joining failed (${res.status}).` };
  return { project_id: body.project_id, member_id: body.member_id };
}

export function Landing({ missingId, initialCode, initialProjectId }: { missingId: string | null; initialCode: string | null; initialProjectId: string | null }) {
  const router = useRouter();
  // Roles already taken, known only when the join link named the project.
  const [takenRoles, setTakenRoles] = useState<string[]>([]);
  useEffect(() => {
    if (!initialProjectId) return;
    let cancelled = false;
    fetch(`/api/projects/${initialProjectId}/members`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { members?: { display_name: string; role: string }[] } | null) => {
        if (cancelled || !body?.members) return;
        setTakenRoles(body.members.map((m) => (m.role ? `${m.role} (${m.display_name})` : m.display_name)));
      })
      .catch(() => {
        // The list is a courtesy; the join still works without it.
      });
    return () => {
      cancelled = true;
    };
  }, [initialProjectId]);
  const [created, setCreated] = useState<Created | null>(null);
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  const [date, setDate] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [code, setCode] = useState(initialCode ?? "");
  const [who, setWho] = useState({ name: "", role: "" });
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, budget_cents: Math.round(parseFloat(budget) * 100), required_by: date })
      });
      const body = (await res.json()) as { project?: { id: string; name: string }; code?: string; error?: string };
      if (!res.ok || !body.project || !body.code) throw new Error(body.error ?? `Creating failed (${res.status}).`);
      setCreated({ id: body.project.id, code: body.code, name: body.project.name });
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function enter(e: FormEvent, roomCode: string, setError: (m: string | null) => void, setBusy: (b: boolean) => void) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await join(roomCode, who.name, who.role);
    if ("error" in result) {
      setError(result.error);
      setBusy(false);
      return;
    }
    saveIdentity({ member_id: result.member_id, display_name: who.name.trim(), role: who.role.trim(), project_id: result.project_id });
    router.push(boardUrl(result.project_id));
  }

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1>Plan a room together</h1>
        <p>One person creates the project and shares its six-character code; the other members join with the code and say who they are. The server holds the project in memory only, so a restart clears it.</p>
      </div>
      {missingId && (
        <div className={styles.message} role="status" data-testid="landing-message">
          The project you were in ({missingId}) is no longer on the server, which happens when the server restarts. Create it again, or join a project that still exists.
        </div>
      )}
      <div className={styles.pair}>
        <section className={styles.card} aria-label="Create a project">
          {!created ? (
            <form onSubmit={create} className={styles.card} style={{ padding: 0, boxShadow: "none" }}>
              <h2>Create a project</h2>
              <div className="field">
                <label htmlFor="create-name">Project name</label>
                <input id="create-name" className="input" value={name} onChange={(e) => setName(e.target.value)} data-testid="create-name" required />
              </div>
              <div className="field">
                <label htmlFor="create-budget">Budget (USD)</label>
                <input id="create-budget" className="input" type="number" min="1" step="1" value={budget} onChange={(e) => setBudget(e.target.value)} data-testid="create-budget" required />
              </div>
              <div className="field">
                <label htmlFor="create-date">Items must arrive by</label>
                <input id="create-date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="create-date" required />
              </div>
              {createError && <p className={styles.error}>{createError}</p>}
              <div className={styles.actions}>
                <button className="btn primary focal" type="submit" disabled={creating} data-testid="create-submit">
                  {creating ? "Creating" : "Create project"}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={(e) => enter(e, created.code, setCreateError, setCreating)} className={styles.card} style={{ padding: 0, boxShadow: "none" }}>
              <h2>{created.name}</h2>
              <p>Share this code with the people joining you. It works until the server restarts.</p>
              <div className={styles.code} data-testid="project-code">
                {created.code}
              </div>
              <WhoAmI idPrefix="create" name={who.name} role={who.role} onName={(v) => setWho({ ...who, name: v })} onRole={(v) => setWho({ ...who, role: v })} />
              {createError && <p className={styles.error}>{createError}</p>}
              <div className={styles.actions}>
                <button className="btn primary focal" type="submit" disabled={creating || !who.name.trim()} data-testid="create-enter">
                  {creating ? "Opening the board" : "Open the board"}
                </button>
              </div>
            </form>
          )}
        </section>
        <section className={styles.card} aria-label="Join with a code">
          <form onSubmit={(e) => enter(e, code, setJoinError, setJoining)} className={styles.card} style={{ padding: 0, boxShadow: "none" }}>
            <h2>Join with a code</h2>
            <div className="field">
              <label htmlFor="join-code">Room code</label>
              <input
                id="join-code"
                className="input"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="6 letters or digits"
                maxLength={6}
                autoCapitalize="characters"
                spellCheck={false}
                data-testid="join-code"
                required
              />
            </div>
            <WhoAmI idPrefix="join" name={who.name} role={who.role} onName={(v) => setWho({ ...who, name: v })} onRole={(v) => setWho({ ...who, role: v })} takenRoles={code === initialCode ? takenRoles : []} />
            {joinError && <p className={styles.error}>{joinError}</p>}
            <div className={styles.actions}>
              <button className="btn primary focal" type="submit" disabled={joining || code.trim().length !== 6 || !who.name.trim()} data-testid="join-submit">
                {joining ? "Joining" : "Join"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
