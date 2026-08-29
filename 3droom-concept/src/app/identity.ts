"use client";
import { useEffect, useState } from "react";

/**
 * Who this browser is inside one project: the member row the join call returned, kept in
 * localStorage per project id. There is no account behind it; a person joins by room code and
 * names themself (PRD 3.1 leaves auth to a later version).
 */
export type Identity = { member_id: string; display_name: string; role: string; project_id: string };

const key = (projectId: string) => `planner:identity:${projectId}`;

export function readIdentity(projectId: string): Identity | null {
  try {
    const raw = window.localStorage.getItem(key(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Identity>;
    if (typeof parsed.member_id !== "string" || typeof parsed.display_name !== "string") return null;
    return { member_id: parsed.member_id, display_name: parsed.display_name, role: parsed.role ?? "", project_id: projectId };
  } catch {
    return null;
  }
}

export function saveIdentity(identity: Identity): void {
  try {
    window.localStorage.setItem(key(identity.project_id), JSON.stringify(identity));
  } catch {
    // Private mode or blocked storage: the session still works, the name is asked again next time.
  }
}

export function clearIdentity(projectId: string): void {
  try {
    window.localStorage.removeItem(key(projectId));
  } catch {
    // Nothing to clear.
  }
}

/** The stored identity for a project; null until hydration and when the browser has not joined. */
export function useIdentity(projectId: string): Identity | null {
  const [identity, setIdentity] = useState<Identity | null>(null);
  useEffect(() => {
    setIdentity(readIdentity(projectId));
  }, [projectId]);
  return identity;
}

/** The name to stamp on a write when the browser has not joined the project. */
export const ANONYMOUS = "member";
