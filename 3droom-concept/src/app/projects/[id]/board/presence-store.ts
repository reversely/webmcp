/**
 * The bridge between the presence heartbeat (presence.tsx) and the board (board-canvas.tsx, #18):
 * the board writes the local pointer here for the next heartbeat to carry, and the heartbeat writes
 * the member list here for the board to draw the others' cursors. A module-level store, because
 * the two components sit in different subtrees of the project layout.
 */
import { useSyncExternalStore } from "react";

export type Cursor = { x: number; y: number };
export type PresenceMember = { id: string; display_name: string; role: string; stage: string | null; last_seen: string; cursor: Cursor | null };

let cursor: Cursor | null = null;
let members: PresenceMember[] = [];
const listeners = new Set<() => void>();

export function setLocalCursor(next: Cursor | null): void {
  cursor = next;
}

export function localCursor(): Cursor | null {
  return cursor;
}

export function setPresenceMembers(next: PresenceMember[]): void {
  members = next;
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function usePresenceMembers(): PresenceMember[] {
  return useSyncExternalStore(subscribe, () => members, () => members);
}

/**
 * A colour per role, derived from the role text so two people with different roles get different
 * dots without the app holding a list of roles (the role is the person's own word).
 */
export function roleColour(role: string): string {
  let hash = 0;
  for (const ch of role.toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 55% 42%)`;
}
