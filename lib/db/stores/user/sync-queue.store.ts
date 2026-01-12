/**
 * Sync queue store operations
 */

import { userDb } from "../../user-db";
import type {
  SyncQueueItem,
  SyncCollection,
  SyncOperationType,
  SyncMeta,
} from "@/types/sync/sync.types";
import type { FlightLog } from "@/types/entities/flight.types";
import type { Aircraft } from "@/types/entities/aircraft.types";
import type { Personnel } from "@/types/entities/crew.types";

/**
 * Add item to sync queue
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

/**
 * Get last sync time
 */
export async function getLastSyncTime(): Promise<number> {
  const meta = await userDb.syncMeta.get("lastSync");
  return meta?.lastSyncAt || 0;
}

/**
 * Set last sync time
 */
export async function setLastSyncTime(timestamp: number): Promise<void> {
  await userDb.syncMeta.put({ key: "lastSync", lastSyncAt: timestamp });
}

/**
 * Mark a record as synced
 */
export async function markRecordSynced(
  collection: SyncCollection,
  id: string,
): Promise<void> {
  const table = userDb[collection];
  const record = await table.get(id);
  if (record) {
    await table.put({
      ...record,
      syncStatus: "synced",
      
    } as any);
  }
}
