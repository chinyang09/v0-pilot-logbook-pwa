/**
 * Sync Queue Store - Offline-first sync queue management
 */

import { userDb } from "../user-db"
import { ulid } from "@/lib/utils/ulid"
import type { SyncQueueItem } from "@/types/infrastructure/db.types"
import type { SyncOperation, SyncCollection } from "@/types/infrastructure/sync.types"
import type { Flight } from "@/types/entities/flight.types"
import type { Crew } from "@/types/entities/crew.types"
import type { UserAircraft } from "@/types/entities/aircraft.types"

/**
 * Add item to sync queue
 */
export async function addToSyncQueue(
  type: SyncOperation,
  collection: SyncCollection,
  data: Flight | Crew | UserAircraft | { id: string; mongoId?: string },
): Promise<void> {
  const item: SyncQueueItem = {
    id: ulid(),
    type,
    timestamp: Date.now(),
    collection,
    data,
    retryCount: 0,
  }
  await userDb.syncQueue.put(item)
}

/**
 * Get all items in sync queue
 */
export async function getSyncQueue(): Promise<SyncQueueItem[]> {
  return userDb.syncQueue.orderBy("timestamp").toArray()
}

/**
 * Remove item from sync queue
 */
export async function clearSyncQueueItem(id: string): Promise<void> {
  await userDb.syncQueue.delete(id)
}

/**
 * Clear entire sync queue
 */
export async function clearSyncQueue(): Promise<void> {
  await userDb.syncQueue.clear()
}

/**
 * Get pending count
 */
export async function getPendingCount(): Promise<number> {
  return userDb.syncQueue.count()
}

/**
 * Increment retry count for failed item
 */
export async function incrementRetryCount(id: string): Promise<void> {
  const item = await userDb.syncQueue.get(id)
  if (item) {
    await userDb.syncQueue.update(id, {
      retryCount: (item.retryCount || 0) + 1,
    })
  }
}

/**
 * Get last sync time
 */
export async function getLastSyncTime(): Promise<number> {
  const meta = await userDb.syncMeta.get("lastSyncTime")
  return meta?.lastSyncAt || 0
}

/**
 * Set last sync time
 */
export async function setLastSyncTime(timestamp: number): Promise<void> {
  await userDb.syncMeta.put({ key: "lastSyncTime", lastSyncAt: timestamp })
}

/**
 * Mark a record as synced (update syncStatus and mongoId)
 */
export async function markRecordSynced(collection: SyncCollection, id: string, mongoId: string): Promise<void> {
  const table = collection === "flights" ? userDb.flights : collection === "crew" ? userDb.crew : userDb.aircraft

  await table.update(id, {
    syncStatus: "synced",
    mongoId,
  })
}
