/**
 * Sync queue management
 */
import { db } from "./database"
import type { SyncQueueItem } from "./core-types"
import type { FlightLog } from "../flight/flight-types"
import type { Aircraft } from "../aircraft/aircraft-types"
import type { Personnel } from "../personnel/personnel-types"

export async function addToSyncQueue(
  type: "create" | "update" | "delete",
  collection: "flights" | "aircraft" | "personnel",
  data: FlightLog | Aircraft | Personnel | { id: string; mongoId?: string },
): Promise<void> {
  await db.syncQueue.put({
    id: crypto.randomUUID(),
    type,
    collection,
    data,
    timestamp: Date.now(),
  })
}

export async function getSyncQueue(): Promise<SyncQueueItem[]> {
  return db.syncQueue.toArray()
}

export async function clearSyncQueueItem(id: string): Promise<void> {
  await db.syncQueue.delete(id)
}

export async function getLastSyncTime(): Promise<number> {
  const meta = await db.syncMeta.get("lastSync")
  return meta?.lastSyncAt || 0
}

export async function setLastSyncTime(timestamp: number): Promise<void> {
  await db.syncMeta.put({ key: "lastSync", lastSyncAt: timestamp })
}

export async function markRecordSynced(
  collection: "flights" | "aircraft" | "personnel",
  id: string,
  mongoId: string,
): Promise<void> {
  const record = await db[collection].get(id)
  if (record) {
    await db[collection].put({
      ...record,
      syncStatus: "synced",
      mongoId,
    } as any)
  }
}

export async function clearAllUserData(): Promise<void> {
  await db.transaction("rw", [db.flights, db.aircraft, db.personnel, db.syncQueue, db.syncMeta], async () => {
    await db.flights.clear()
    await db.aircraft.clear()
    await db.personnel.clear()
    await db.syncQueue.clear()
    await db.syncMeta.clear()
  })
}

export async function clearAllLocalData(): Promise<void> {
  await db.transaction("rw", [db.flights, db.aircraft, db.personnel, db.syncQueue, db.syncMeta], async () => {
    await db.flights.clear()
    await db.aircraft.clear()
    await db.personnel.clear()
    await db.syncQueue.clear()
    await db.syncMeta.clear()
  })
}
