/**
 * Client-side bookkeeping for board sync (#18): what the local user changed and has not sent yet,
 * when each record was last touched locally, and which remote records to skip because the local
 * user changed them inside the last poll window. Pure, so it is unit-tested without tldraw.
 */
export type BoardRecord = { id: string; typeName: string } & Record<string, unknown>;
export type BoardChanges = { put: BoardRecord[]; remove: string[] };
export type BoardDelta = { version: number; put: BoardRecord[]; remove: string[] };

/** The shape of a tldraw RecordsDiff, reduced to what the sync needs. */
export type Diff = { added: Record<string, BoardRecord>; updated: Record<string, [BoardRecord, BoardRecord]>; removed: Record<string, BoardRecord> };

export class PendingChanges {
  private put = new Map<string, BoardRecord>();
  private remove = new Set<string>();
  private touched = new Map<string, number>();

  /** Folds one local history entry in; a later change to the same id replaces the earlier one. */
  record(diff: Diff, now: number): void {
    for (const r of Object.values(diff.added)) this.add(r, now);
    for (const [, to] of Object.values(diff.updated)) this.add(to, now);
    for (const id of Object.keys(diff.removed)) {
      this.put.delete(id);
      this.remove.add(id);
      this.touched.set(id, now);
    }
  }

  private add(r: BoardRecord, now: number) {
    this.put.set(r.id, r);
    this.remove.delete(r.id);
    this.touched.set(r.id, now);
  }

  get empty(): boolean {
    return this.put.size === 0 && this.remove.size === 0;
  }

  /** Takes everything pending for one PUT and clears it. */
  take(): BoardChanges {
    const changes = { put: [...this.put.values()], remove: [...this.remove] };
    this.put.clear();
    this.remove.clear();
    return changes;
  }

  /** Puts a failed PUT back, under anything the user changed since it was taken. */
  restore(changes: BoardChanges): void {
    for (const r of changes.put) if (!this.put.has(r.id) && !this.remove.has(r.id)) this.put.set(r.id, r);
    for (const id of changes.remove) if (!this.put.has(id)) this.remove.add(id);
  }

  /**
   * Drops from a remote delta every record the local user changed within `windowMs` of `now` or
   * still has pending, so a poll never undoes a local edit that has not reached the server yet.
   */
  filterRemote(delta: BoardDelta, now: number, windowMs: number): BoardDelta {
    const local = (id: string) => this.put.has(id) || this.remove.has(id) || now - (this.touched.get(id) ?? -Infinity) < windowMs;
    return { version: delta.version, put: delta.put.filter((r) => !local(r.id)), remove: delta.remove.filter((id) => !local(id)) };
  }
}
