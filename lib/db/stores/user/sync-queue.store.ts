/**
 * Sync queue store operations
 */

import { userDb } from "../../user-db";
import type {
  SyncQueueItem,
  SyncCollection,
  SyncOperationType,
  CollectionCursor,
} from "@/types/sync/sync.types";
import type { FlightLog } from "@/types/entities/flight.types";
import type { Aircraft } from "@/types/entities/aircraft.types";
import type { Personnel } from "@/types/entities/crew.types";

/**
 * Add item to sync queue
 * Also notifies the sync trigger manager for intelligent sync scheduling
 */
export async function addToSyncQueue(
  type: SyncOperationType,
  collection: SyncCollection,
  data: FlightLog | Aircraft | Personnel | { id: string }
): Promise<void> {
  await userDb.syncQueue.put({
    id: crypto.randomUUID(),
    type,
    collection,
    data,
    timestamp: Date.now(),
    retryCount: 0,
  });

  // Notify sync service of data change (for intelligent triggers)
  if (typeof window !== "undefined") {
    // Dynamically import to avoid circular dependency
    import("@/lib/sync").then(({ syncService }) => {
      syncService.notifyDataChange();
    }).catch(err => {
      console.warn("[v0] Failed to notify sync service:", err);
    });
  }
}

/**
 * Get all items in sync queue
 */
export async function getSyncQueue(): Promise<SyncQueueItem[]> {
  return userDb.syncQueue.toArray();
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
export async function getDeviceId(): Promise<string> {
  const existing = await getMetaValue<string>(DEVICE_ID_KEY);
  if (existing && typeof existing === "string") return existing;
  const id = crypto.randomUUID();
  await setMetaValue(DEVICE_ID_KEY, id);
  return id;
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
  entries: { id: string; pushedUpdatedAt?: number; pushedTimestamp: number }[]
): Promise<void> {
  if (entries.length === 0) return;
  const table = userDb[collection];
  await userDb.transaction("rw", table, userDb.syncQueue, async () => {
    for (const entry of entries) {
      const record = await table.get(entry.id);
      if (record) {
        const current = record as { updatedAt?: number };
        // Compare-and-set: only flip to synced if untouched since push.
        if (current.updatedAt === entry.pushedUpdatedAt) {
          await table.put({ ...record, syncStatus: "synced" } as never);
        }
      }
      // Clear only queue rows for this record that were part of (or older than)
      // what we pushed. Rows enqueued AFTER the push snapshot have a larger
      // timestamp and are intentionally preserved so the new edit re-syncs.
      const staleRows = await userDb.syncQueue
        .where("collection")
        .equals(collection)
        .filter((row) => {
          const rowId = (row.data as { id?: string })?.id;
          return rowId === entry.id && row.timestamp <= entry.pushedTimestamp;
        })
        .primaryKeys();
      if (staleRows.length > 0) {
        await userDb.syncQueue.bulkDelete(staleRows);
      }
    }
  });
}
