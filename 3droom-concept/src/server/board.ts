/**
 * The board document as the server keeps it (#18): one tldraw record per id with the board
 * version at which it was last written, plus a tombstone per removed id. Two browsers sync by
 * sending their own changes and asking for everything written after the version they hold.
 *
 * Merging is last-writer-wins on the server clock: writes apply in the order they reach the
 * server, and a later write to the same id replaces the earlier one whole. A put after a remove
 * brings the record back; a remove after a put drops it.
 */

/** A tldraw record as JSON; the server keeps it opaque beyond `id` and `typeName`. */
export type BoardRecord = { id: string; typeName: string } & Record<string, unknown>;

export type BoardDoc = {
  /** Bumped once per write request; every record in that request carries it. */
  version: number;
  records: Map<string, { record: BoardRecord; version: number }>;
  /** Removed ids and the version of the write that removed them. */
  removed: Map<string, number>;
};

export type BoardChanges = { put?: BoardRecord[]; remove?: string[] };

/** What changed after a version: records to put, ids to remove, and the version this delta reaches. */
export type BoardDelta = { version: number; put: BoardRecord[]; remove: string[] };

export function emptyBoard(): BoardDoc {
  return { version: 0, records: new Map(), removed: new Map() };
}

function isRecord(value: unknown): value is BoardRecord {
  return !!value && typeof value === "object" && typeof (value as BoardRecord).id === "string" && typeof (value as BoardRecord).typeName === "string";
}

/** Applies one client's changes in arrival order and returns the new version. Empty changes leave the version alone. */
export function applyBoardChanges(doc: BoardDoc, changes: BoardChanges): number {
  const put = (changes.put ?? []).filter(isRecord);
  const remove = (changes.remove ?? []).filter((id): id is string => typeof id === "string");
  if (put.length === 0 && remove.length === 0) return doc.version;
  const version = doc.version + 1;
  for (const record of put) {
    doc.records.set(record.id, { record, version });
    doc.removed.delete(record.id);
  }
  for (const id of remove) {
    doc.records.delete(id);
    doc.removed.set(id, version);
  }
  doc.version = version;
  return version;
}

/** Everything written after `since` (0 for the whole board). */
export function boardChangesSince(doc: BoardDoc, since: number): BoardDelta {
  const put: BoardRecord[] = [];
  for (const { record, version } of doc.records.values()) if (version > since) put.push(record);
  const remove: string[] = [];
  for (const [id, version] of doc.removed) if (version > since) remove.push(id);
  return { version: doc.version, put, remove };
}

/** The whole board for a first load: every live record and the version they add up to. */
export function boardSnapshot(doc: BoardDoc): { version: number; records: BoardRecord[] } {
  return { version: doc.version, records: [...doc.records.values()].map((r) => r.record) };
}
