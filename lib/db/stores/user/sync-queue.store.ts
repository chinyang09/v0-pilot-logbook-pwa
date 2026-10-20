/**
 * Sync queue store operations
 */

import { userDb } from "../../user-db";
import type {
  SyncQueueItem,
  SyncCollection,
  SyncOperationType,
  CollectionCursor,
  SyncChangeMeta,
} from "@/types/sync/sync.types";
import { earlierBase, sameValue, unionFields } from "@/lib/sync/changes";

type SyncQueueData = SyncQueueItem["data"];

function notifySyncService() {
  if (typeof window !== "undefined") {
    // Dynamically import to avoid circular dependency
    import("@/lib/sync")
      .then(({ syncService }) => syncService.notifyDataChange())
      .catch((err) => console.warn("[v0] Failed to notify sync service:", err));
  }
}

/**
 * Add an item to the sync queue, deduplicating to ONE live row per record
 * (via the `[collection+recordId]` index):
 * - create/update: collapse into the existing pending row (keeping a "create"
 *   type sticky), refreshing data + timestamp. N rapid edits → 1 row.
 * - delete: drop any pending rows for the record; if a not-yet-pushed CREATE
 *   was pending the create+delete cancel out entirely (nothing to send),
 *   otherwise a single delete row is enqueued.
 * Also notifies the sync trigger manager for intelligent scheduling.
 */
export async function addToSyncQueue(
  type: SyncOperationType,
  collection: SyncCollection,
  data: SyncQueueData,
  meta: SyncChangeMeta = {}
): Promise<void> {
  // ONE transaction for the read and the write. Between them, a reconcile of
  // the previous push (or another tab's enqueue) could delete or rewrite the
  // row this edit collapses into — the put then resurrected a confirmed
  // CREATE row, which the server decides by clock rather than by field.
  await userDb.transaction("rw", userDb.syncQueue, () => enqueueInTransaction(type, collection, data, meta));
  notifySyncService();
}

async function enqueueInTransaction(
  type: SyncOperationType,
  collection: SyncCollection,
  data: SyncQueueData,
  meta: SyncChangeMeta
): Promise<void> {
  const recordId = (data as { id?: string }).id;

  if (recordId) {
    const existingRows = await userDb.syncQueue
      .where("[collection+recordId]")
      .equals([collection, recordId])
      .toArray();

    if (type === "delete") {
      const keys = existingRows.map((r) => r.id);
      if (keys.length) await userDb.syncQueue.bulkDelete(keys);
      const hadPendingCreate = existingRows.some((r) => r.type === "create");
      // A record created but never pushed → fully cancel; nothing to delete.
      if (!hadPendingCreate) {
        await userDb.syncQueue.put({
          id: crypto.randomUUID(),
          type: "delete",
          collection,
          recordId,
          data: { id: recordId },
          timestamp: Date.now(),
          retryCount: 0,
          ...(meta.baseSeq !== undefined ? { baseSeq: meta.baseSeq } : {}),
        });
      }
      return;
    }

    // create / update — collapse into an existing pending (non-delete) row.
    const existing = existingRows.find((r) => r.type !== "delete");
    if (existing) {
      // A pending create stays a create even after later edits. Its field set
      // is still tracked: a create is sent whole, but if the create is
      // confirmed while a later edit sits in this row, the row becomes a
      // field patch of exactly these fields (see reconcilePushedRecords).
      const nextType = existing.type === "create" ? "create" : type;
      const changedFields = unionFields(existing.changedFields, meta.changedFields);
      const { changedFields: _c, baseSeq: _b, ...rest } = existing;
      const baseSeq = earlierBase(existing.baseSeq, meta.baseSeq);
      await userDb.syncQueue.put({
        ...rest,
        type: nextType,
        data,
        timestamp: Date.now(),
        retryCount: 0,
        ...(changedFields !== undefined ? { changedFields } : {}),
        ...(baseSeq !== undefined ? { baseSeq } : {}),
      });
      return;
    }
  }

  await userDb.syncQueue.put({
    id: crypto.randomUUID(),
    type,
    collection,
    recordId,
    data,
    timestamp: Date.now(),
    retryCount: 0,
    ...(type !== "delete" && meta.changedFields !== undefined ? { changedFields: meta.changedFields } : {}),
    ...(meta.baseSeq !== undefined ? { baseSeq: meta.baseSeq } : {}),
  });
}

/**
 * Bulk-enqueue many sync operations in one write (used by CSV/import paths that
 * write records inside their own Dexie transaction, then enqueue afterwards).
 * Appends rows; the next push compaction collapses any same-record duplicates.
 */
export async function enqueueMany(
  items: ({ type: SyncOperationType; collection: SyncCollection; data: SyncQueueData } & SyncChangeMeta)[]
): Promise<void> {
  if (items.length === 0) return;
  const now = Date.now();
  const rows: SyncQueueItem[] = items.map((it) => ({
    id: crypto.randomUUID(),
    type: it.type,
    collection: it.collection,
    recordId: (it.data as { id?: string }).id,
    data: it.data,
    timestamp: now,
    retryCount: 0,
    ...(it.type !== "delete" && it.changedFields !== undefined ? { changedFields: it.changedFields } : {}),
    ...(it.baseSeq !== undefined ? { baseSeq: it.baseSeq } : {}),
  }));
  await userDb.syncQueue.bulkPut(rows);
  notifySyncService();
}

/**
 * Get all items in sync queue
 */
export async function getSyncQueue(): Promise<SyncQueueItem[]> {
  return userDb.syncQueue.toArray();
}

/**
 * How many items are waiting, without materialising any of them.
 *
 * The trigger manager polls "is there anything to sync?" every 10 seconds for
 * the whole session, and it was answering that by reading the entire queue
 * table and taking `.length` — deserialising every pending row, on the main
 * thread, to compare a number against zero. `count()` answers it off the index.
 */
export async function getSyncQueueCount(): Promise<number> {
  return userDb.syncQueue.count();
}

/**
 * Get sync queue items by collection
 */
export async function getSyncQueueByCollection(
  collection: SyncCollection
): Promise<SyncQueueItem[]> {
  return userDb.syncQueue.where("collection").equals(collection).toArray();
}

/**
 * Clear a sync queue item
 */
export async function clearSyncQueueItem(id: string): Promise<void> {
  await userDb.syncQueue.delete(id);
}

/**
 * Clear all sync queue items for a collection
 */
export async function clearSyncQueueByCollection(
  collection: SyncCollection
): Promise<void> {
  await userDb.syncQueue.where("collection").equals(collection).delete();
}

/**
 * Increment retry count for a sync queue item
 */
export async function incrementRetryCount(id: string): Promise<void> {
  const item = await userDb.syncQueue.get(id);
  if (item) {
    await userDb.syncQueue.put({
      ...item,
      retryCount: (item.retryCount || 0) + 1,
    });
  }
}

// ---------------------------------------------------------------------------
// Generic sync metadata (key/value rows in syncMeta — no schema change needed)
// ---------------------------------------------------------------------------

/**
 * Read a generic sync metadata value by key.
 */
export async function getMetaValue<T>(key: string): Promise<T | undefined> {
  const meta = await userDb.syncMeta.get(key);
  return meta?.value as T | undefined;
}

/**
 * Write a generic sync metadata value by key.
 */
export async function setMetaValue(key: string, value: unknown): Promise<void> {
  await userDb.syncMeta.put({ key, value });
}

const DEVICE_ID_KEY = "deviceId";

/**
 * Stable per-device identifier, generated once and persisted. Used as the
 * deterministic tiebreaker in last-write-wins conflict resolution so two edits
 * with the same `updatedAt` resolve the same way on every device.
 */
/**
 * Cached for the life of the process, because it is a per-device CONSTANT that
 * was being read from IndexedDB on every single entity write — one extra
 * round-trip per created or updated row, and an import creates thousands.
 *
 * The promise itself is cached rather than the value, so concurrent first
 * callers share one read instead of racing to mint competing ids.
 */
let deviceIdPromise: Promise<string> | null = null;

export async function getDeviceId(): Promise<string> {
  if (deviceIdPromise) return deviceIdPromise;
  deviceIdPromise = (async () => {
    const existing = await getMetaValue<string>(DEVICE_ID_KEY);
    if (existing && typeof existing === "string") return existing;
    const id = crypto.randomUUID();
    await setMetaValue(DEVICE_ID_KEY, id);
    return id;
  })().catch((error) => {
    // Never cache a failure — the next caller should get a real attempt.
    deviceIdPromise = null;
    throw error;
  });
  return deviceIdPromise;
}

const cursorKey = (collection: SyncCollection) => `cursor:${collection}`;

/**
 * Per-collection delta-pull cursor (server-authored `seq` + `_id` tiebreaker).
 */
export async function getCollectionCursor(
  collection: SyncCollection
): Promise<CollectionCursor> {
  const v = await getMetaValue<CollectionCursor>(cursorKey(collection));
  if (v && typeof v.seq === "number") {
    return { seq: v.seq, id: typeof v.id === "string" ? v.id : "" };
  }
  return { seq: 0, id: "" };
}

export async function setCollectionCursor(
  collection: SyncCollection,
  cursor: CollectionCursor
): Promise<void> {
  await setMetaValue(cursorKey(collection), { seq: cursor.seq, id: cursor.id });
}

/**
 * Reset all per-collection cursors (used on full resync).
 */
export async function resetAllCollectionCursors(
  collections: readonly SyncCollection[]
): Promise<void> {
  for (const c of collections) {
    await setCollectionCursor(c, { seq: 0, id: "" });
  }
}

// ---------------------------------------------------------------------------
// Audit counters (Phase 0 instrumentation — detect silent push loss)
// ---------------------------------------------------------------------------

export type SyncAuditKey = "pushAttempted" | "pushConfirmed";

export async function bumpSyncAudit(key: SyncAuditKey, n: number): Promise<void> {
  if (n === 0) return;
  const k = `audit:${key}`;
  const current = (await getMetaValue<number>(k)) || 0;
  await setMetaValue(k, current + n);
}

export async function getSyncAudit(): Promise<{ pushAttempted: number; pushConfirmed: number }> {
  return {
    pushAttempted: (await getMetaValue<number>("audit:pushAttempted")) || 0,
    pushConfirmed: (await getMetaValue<number>("audit:pushConfirmed")) || 0,
  };
}

/**
 * Get last sync time (wall-clock tombstone watermark)
 */
export async function getLastSyncTime(): Promise<number> {
  const meta = await userDb.syncMeta.get("lastSync");
  return meta?.lastSyncAt || 0;
}

/**
 * Set last sync time (wall-clock tombstone watermark)
 */
export async function setLastSyncTime(timestamp: number): Promise<void> {
  await userDb.syncMeta.put({ key: "lastSync", lastSyncAt: timestamp });
}

/**
 * Mark a record as synced (legacy single-record helper — prefer the
 * compare-and-set bulk variant below in the sync engine).
 */
export async function markRecordSynced(
  collection: SyncCollection,
  id: string,
): Promise<void> {
  const table = userDb[collection];
  const record = await table.get(id);
  if (record) {
    await table.put({ ...record, syncStatus: "synced" } as never);
  }
}

/**
 * Transactionally mark records synced, but ONLY when the record hasn't been
 * edited since it was pushed. We compare the record's current `updatedAt`
 * against the value captured at push time: if they differ, an interleaved edit
 * re-queued the record, so we must NOT clobber its `syncStatus` back to
 * "synced" (that would hide the new edit from the next push — a lost update).
 *
 * Runs inside a single Dexie rw transaction over [table, syncQueue] so the
 * mark + queue-row clear are atomic with respect to concurrent mutations.
 */
export async function reconcilePushedRecords(
  collection: SyncCollection,
  entries: {
    id: string;
    pushedUpdatedAt?: number;
    pushedTimestamp: number;
    serverSeq?: number;
    /** The record as it was pushed, to tell which kept fields are now on the server. */
    pushedData?: Record<string, unknown>;
  }[]
): Promise<void> {
  if (entries.length === 0) return;
  const table = userDb[collection];
  await userDb.transaction("rw", table, userDb.syncQueue, async () => {
    for (const entry of entries) {
      const record = await table.get(entry.id);
      if (record) {
        const current = record as { updatedAt?: number; serverSeq?: number };
        // The record now stands at the seq this push was written at. Recording
        // it is what makes this device's NEXT edit based on its own write —
        // without it the server would see that write as someone else's.
        const seq =
          typeof entry.serverSeq === "number" && entry.serverSeq > (current.serverSeq ?? 0)
            ? { serverSeq: entry.serverSeq }
            : {};
        // Compare-and-set: only flip to synced if untouched since push.
        if (current.updatedAt === entry.pushedUpdatedAt) {
          await table.put({ ...record, ...seq, syncStatus: "synced" } as never);
        } else if (seq.serverSeq !== undefined) {
          await table.put({ ...record, ...seq } as never);
        }
      }
      // Clear only queue rows for this record that were part of (or older than)
      // what we pushed. Rows enqueued AFTER the push snapshot have a larger
      // timestamp and are intentionally preserved so the new edit re-syncs.
      const rows = await userDb.syncQueue
        .where("[collection+recordId]")
        .equals([collection, entry.id])
        .toArray();
      const staleRows = rows.filter((row) => row.timestamp <= entry.pushedTimestamp).map((row) => row.id);
      if (staleRows.length > 0) {
        await userDb.syncQueue.bulkDelete(staleRows);
      }
      // An edit made while the CREATE was in flight collapsed into the create
      // row. The record exists on the server now, so what is left is an edit
      // of it: a field patch based on the seq the create landed at, not a
      // second whole-record write.
      if (typeof entry.serverSeq === "number") {
        for (const row of rows) {
          if (row.timestamp <= entry.pushedTimestamp) continue;
          if (row.type === "create") {
            await userDb.syncQueue.put({ ...row, type: "update", baseSeq: entry.serverSeq });
            continue;
          }
          // An UPDATE row an edit collapsed into while this push was in flight
          // carries the union of both edits' fields and the FIRST edit's base.
          // The pushed fields are on the server now, at `serverSeq`: re-sending
          // them against the old base made a later edit to them on another
          // device look concurrent with ours, and the clock could hand the
          // field back to our older value. Keep only what changed since the
          // push, based on the seq the push landed at.
          if (row.type !== "update" || !row.changedFields || !entry.pushedData) continue;
          const data = row.data as unknown as Record<string, unknown>;
          const remaining = row.changedFields.filter((f) => !sameValue(data[f], entry.pushedData![f]));
          if (remaining.length === 0) {
            await userDb.syncQueue.delete(row.id);
            const latest = await table.get(entry.id);
            if (latest && (latest as { updatedAt?: number }).updatedAt === (data.updatedAt as number | undefined)) {
              await table.put({ ...latest, syncStatus: "synced" } as never);
            }
          } else {
            await userDb.syncQueue.put({ ...row, changedFields: remaining, baseSeq: entry.serverSeq });
          }
        }
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Round-trip sync state (`/api/sync`)
// ---------------------------------------------------------------------------

/**
 * What the single round-trip protocol keeps per device, beside the
 * per-collection record cursors:
 *
 * - `tombSeq`  — the deletion cursor. Tombstones are sequenced on the same
 *   per-user counter as records, so deletions no longer ride a wall clock.
 * - `knownSeq` — the user's seq head as of the last COMPLETE pull. Sending it
 *   lets the server answer "nothing changed" with one lookup.
 * - `protocol` — which protocol this device last synced with. A device that
 *   has never run this one re-pulls everything once (see `ensureProtocol` in
 *   the sync service).
 */
export interface RoundTripSyncState {
  tombSeq: number
  knownSeq: number
  protocol: number
}

export async function getRoundTripSyncState(): Promise<RoundTripSyncState> {
  const v = await getMetaValue<Partial<RoundTripSyncState>>("roundTrip");
  const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 0);
  return { tombSeq: num(v?.tombSeq), knownSeq: num(v?.knownSeq), protocol: num(v?.protocol) };
}

export async function setRoundTripSyncState(patch: Partial<RoundTripSyncState>): Promise<void> {
  const current = await getRoundTripSyncState();
  await setMetaValue("roundTrip", { ...current, ...patch });
}

/** Bookkeeping keys an orphan's field patch never claims to have changed. */
const QUEUE_META_FIELDS = new Set([
  "id", "userId", "createdAt", "updatedAt", "deviceId", "syncStatus", "serverSeq", "syncedAt", "schemaVersion", "fieldVersions",
]);

/**
 * Records that are marked as needing a push but have NO queue row behind them.
 *
 * Every store writes the record and THEN enqueues, in two separate IndexedDB
 * writes; a tab closed between them leaves an edit that nothing will ever
 * send. Re-enqueueing these each cycle is what makes "an offline edit gets
 * pushed at the earliest opportunity" true even across a crash. `error` rows
 * (dead-lettered after their retries) are included only when asked — re-trying
 * a poison item every cycle is exactly what dead-lettering exists to stop.
 */
export async function requeueOrphanedRecords(
  collections: readonly SyncCollection[],
  { includeErrored = false }: { includeErrored?: boolean } = {}
): Promise<number> {
  const statuses = includeErrored ? ["pending", "error"] : ["pending"];
  const toEnqueue: ({ type: SyncOperationType; collection: SyncCollection; data: SyncQueueData } & SyncChangeMeta)[] = [];
  const tables = collections.map((c) => userDb[c]);
  // One read transaction for every table and the queue, not two per table.
  await userDb.transaction("r", [...tables, userDb.syncQueue], async () => {
    const queued = new Set(
      (await userDb.syncQueue.toArray()).map(
        (row) => `${row.collection}:${row.recordId ?? (row.data as { id?: string })?.id}`
      )
    );
    for (const collection of collections) {
      const table = userDb[collection] as unknown as {
        where: (k: string) => { anyOf: (v: string[]) => { toArray: () => Promise<{ id: string }[]> } };
      };
      const candidates = await table.where("syncStatus").anyOf(statuses).toArray();
      for (const record of candidates) {
        if (queued.has(`${collection}:${record.id}`)) continue;
        // Which fields the lost edit touched is not known, but WHERE it started
        // is: the seq the record last stood at here. Pushed as a patch of every
        // field against that base, the server keeps whatever another device
        // changed since and arbitrates only the fields genuinely contested —
        // where a whole-record write is decided by clock, and a stale copy
        // with a newer `updatedAt` reverts every field it never saw. A record
        // that never reached the server has no base and goes up whole.
        const seq = (record as { serverSeq?: number }).serverSeq;
        if (typeof seq === "number") {
          const changedFields = Object.keys(record).filter((k) => !QUEUE_META_FIELDS.has(k));
          toEnqueue.push({ type: "update", collection, data: record as SyncQueueData, changedFields, baseSeq: seq });
        } else {
          toEnqueue.push({ type: "update", collection, data: record as SyncQueueData });
        }
      }
    }
  });
  if (toEnqueue.length > 0) await enqueueMany(toEnqueue);
  return toEnqueue.length;
}

/**
 * Everything a sync round needs from `syncMeta` — the cursors, the round-trip
 * state and the tombstone watermark — in ONE read. It was eight separate
 * IndexedDB round trips per request, and on a phone each one is felt.
 */
export async function readSyncSnapshot(collections: readonly SyncCollection[]): Promise<{
  state: RoundTripSyncState;
  cursors: Record<SyncCollection, CollectionCursor>;
  since: number;
}> {
  const keys = [...collections.map(cursorKey), "roundTrip", "lastSync"];
  const rows = await userDb.syncMeta.bulkGet(keys);
  const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 0);
  const cursors = {} as Record<SyncCollection, CollectionCursor>;
  collections.forEach((c, i) => {
    const v = rows[i]?.value as Partial<CollectionCursor> | undefined;
    cursors[c] = { seq: num(v?.seq), id: typeof v?.id === "string" ? v.id : "" };
  });
  const rt = rows[collections.length]?.value as Partial<RoundTripSyncState> | undefined;
  return {
    state: { tombSeq: num(rt?.tombSeq), knownSeq: num(rt?.knownSeq), protocol: num(rt?.protocol) },
    cursors,
    since: num(rows[collections.length + 1]?.lastSyncAt),
  };
}
