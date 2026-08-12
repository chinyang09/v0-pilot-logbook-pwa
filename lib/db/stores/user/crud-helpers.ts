/**
 * Generic CRUD helper functions for store operations
 * Reduces code duplication across entity stores
 */

import type { Table } from "dexie"
import { addToSyncQueue, enqueueMany, getDeviceId } from "./sync-queue.store"
import { DELETED_RETENTION_MS, isWithinRetention } from "@/lib/utils/retention"

/**
 * Base entity interface that all syncable entities must implement
 */
export interface SyncableEntity {
  id: string
  userId?: string
  createdAt: number
  updatedAt?: number
  syncStatus?: "pending" | "synced" | "error"
  // Sync engine: server-authored monotonic version (delta cursor)
  serverSeq?: number
  // Sync engine: authoring device, used as a deterministic LWW tiebreaker
  deviceId?: string
  /**
   * Soft-delete stamp — the row is in Recently Deleted, not gone.
   *
   * `null` rather than `undefined` when CLEARED: `/api/sync/bulk` applies an
   * update as a `$set` of the payload's keys and `JSON.stringify` drops
   * undefined ones, so an undefined here would leave the server's stamp in
   * place and the next pull would undo the restore.
   */
  deletedAt?: number | null
}

/**
 * A row that should appear in a list, a total or an import match.
 *
 * Read every list through this. A deleted row that reaches the reconciler
 * would be silently updated and so resurrected — the exact bug `isLiveFlight`
 * exists to prevent, now that every entity can be deleted rather than only
 * flights.
 */
export function isLiveEntity<T extends SyncableEntity>(entity: T): boolean {
  return entity.deletedAt == null
}

/** In Recently Deleted and still restorable. */
export function isDeletedEntity<T extends SyncableEntity>(entity: T): boolean {
  return entity.deletedAt != null && isWithinRetention(entity.deletedAt, Date.now(), DELETED_RETENTION_MS)
}

/**
 * Deterministic last-write-wins comparison. Orders by (updatedAt, deviceId) so
 * two concurrent edits with the same timestamp resolve identically on every
 * device instead of "whoever the server saw last" / "server always wins".
 * Returns > 0 if `a` wins, < 0 if `b` wins, 0 if identical authorship.
 */
export function compareAuthorship(a: SyncableEntity, b: SyncableEntity): number {
  const at = a.updatedAt ?? a.createdAt ?? 0
  const bt = b.updatedAt ?? b.createdAt ?? 0
  if (at !== bt) return at - bt
  const ad = a.deviceId ?? ""
  const bd = b.deviceId ?? ""
  return ad < bd ? -1 : ad > bd ? 1 : 0
}

/**
 * Table name type for sync queue operations
 */
export type SyncableTableName =
  | "flights"
  | "personnel"
  | "aircraft"
  | "scheduleEntries"
  | "currencies"
  | "discrepancies"

/**
 * Generic add operation for syncable entities
 */
export async function createEntity<T extends SyncableEntity>(
  table: Table<T>,
  tableName: SyncableTableName,
  data: Omit<T, "id" | "createdAt" | "updatedAt" | "syncStatus">,
  options?: { includeUpdatedAt?: boolean }
): Promise<T> {
  const now = Date.now()
  const deviceId = await getDeviceId()
  const newEntity = {
    ...data,
    id: crypto.randomUUID(),
    createdAt: now,
    ...(options?.includeUpdatedAt !== false && { updatedAt: now }),
    deviceId,
    syncStatus: "pending" as const,
  } as unknown as T

  await table.put(newEntity)
  await addToSyncQueue("create", tableName, newEntity)

  return newEntity
}

/**
 * Write rows that ALREADY HAVE ids, and put them on the sync queue.
 *
 * `createEntity` mints an id, which is exactly why the importers could not use
 * it: an import resolves crew before it builds flights, so the flight rows are
 * already pointing at `person.id` by the time anything is written. They reached
 * for `table.put()` instead — and that is a raw Dexie write with no queue entry
 * behind it, so **every crew member, currency and discrepancy an import created
 * lived only on the device that ran the import**. Flights and aircraft were
 * fine; they go through the store helpers.
 *
 * Bulk on purpose: one `bulkPut` and one `enqueueMany` instead of 2N round
 * trips, which for a migration's crew list is the difference between one write
 * and several hundred.
 */
export async function putManyWithSync<T extends SyncableEntity>(
  table: Table<T>,
  tableName: SyncableTableName,
  entities: T[],
  type: "create" | "update" = "create"
): Promise<T[]> {
  if (entities.length === 0) return []

  const now = Date.now()
  const deviceId = await getDeviceId()
  const stamped = entities.map((entity) => ({
    ...entity,
    updatedAt: now,
    deviceId,
    syncStatus: "pending" as const,
  })) as T[]

  await table.bulkPut(stamped)
  await enqueueMany(
    stamped.map((data) => ({ type, collection: tableName, data }))
  )

  return stamped
}

/** Single-row form of `putManyWithSync`, for a call site that has just one. */
export async function putWithSync<T extends SyncableEntity>(
  table: Table<T>,
  tableName: SyncableTableName,
  entity: T,
  type: "create" | "update" = "create"
): Promise<T> {
  const [written] = await putManyWithSync(table, tableName, [entity], type)
  return written
}

/**
 * Generic update operation for syncable entities
 */
export async function updateEntity<T extends SyncableEntity>(
  table: Table<T>,
  tableName: SyncableTableName,
  id: string,
  updates: Partial<T>
): Promise<T | null> {
  const existing = await table.get(id)
  if (!existing) return null

  const deviceId = await getDeviceId()
  const updatedEntity = {
    ...existing,
    ...updates,
    updatedAt: Date.now(),
    deviceId,
    syncStatus: "pending",
  } as T

  await table.put(updatedEntity)
  await addToSyncQueue("update", tableName, updatedEntity)

  return updatedEntity
}

/**
 * SOFT delete — the row goes to Recently Deleted, it does not go away.
 *
 * This pushes an UPDATE, not a delete, and that is what makes Recently Deleted
 * work across devices: binning and restoring both ride the ordinary sync path,
 * and only `purgeEntity` below ever writes a tombstone. Pushing a real delete
 * here would mean the row was gone on every other device with nothing left to
 * restore.
 */
export async function deleteEntity<T extends SyncableEntity>(
  table: Table<T>,
  tableName: SyncableTableName,
  id: string
): Promise<boolean> {
  const existing = await table.get(id)
  if (!existing) return false
  if (existing.deletedAt != null) return true

  return (await updateEntity(table, tableName, id, { deletedAt: Date.now() } as Partial<T>)) != null
}

/** Put a soft-deleted row back. Clears the stamp with `null`, never undefined. */
export async function restoreEntity<T extends SyncableEntity>(
  table: Table<T>,
  tableName: SyncableTableName,
  id: string
): Promise<boolean> {
  const existing = await table.get(id)
  if (!existing) return false

  return (await updateEntity(table, tableName, id, { deletedAt: null } as Partial<T>)) != null
}

/**
 * HARD delete — the row and a tombstone, so it is gone everywhere.
 *
 * Only two things call this: "Delete permanently" in Recently Deleted, and the
 * sweep that runs when a row's 30 days are up.
 */
export async function purgeEntity<T extends SyncableEntity>(
  table: Table<T>,
  tableName: SyncableTableName,
  id: string
): Promise<boolean> {
  const existing = await table.get(id)
  if (!existing) return false

  await table.delete(id)
  await addToSyncQueue("delete", tableName, { id })

  return true
}

/** Destroy everything whose window has closed. Returns how many went. */
export async function purgeExpiredEntities<T extends SyncableEntity>(
  table: Table<T>,
  tableName: SyncableTableName,
  now = Date.now()
): Promise<number> {
  const all = await table.toArray()
  const expired = all.filter(
    (e) => e.deletedAt != null && !isWithinRetention(e.deletedAt, now, DELETED_RETENTION_MS)
  )
  for (const e of expired) await purgeEntity(table, tableName, e.id)
  return expired.length
}

/**
 * Generic silent delete operation (no sync queue)
 * Used for server-initiated deletes
 * Includes fallback filter for data inconsistency handling
 */
export async function silentDeleteEntity<T extends SyncableEntity>(
  table: Table<T>,
  id: string
): Promise<boolean> {
  const existing = await table.get(id)

  if (!existing) {
    // Fallback: try filter-based lookup for data inconsistencies
    const byFilter = await table.filter((item: T) => item.id === id).first()
    if (byFilter) {
      await table.delete(byFilter.id)
      return true
    }
    return false
  }

  await table.delete(id)
  return true
}

/**
 * Generic upsert from server operation
 * Handles conflict resolution using last-write-wins strategy
 */
export async function upsertFromServer<T extends SyncableEntity>(
  table: Table<T>,
  serverData: T,
  normalizer: (data: T) => T
): Promise<void> {
  const normalized = normalizer(serverData)

  // Double lookup pattern for reliability
  let existing: T | undefined
  if (normalized.id) {
    existing = await table.where("id").equals(normalized.id).first()
  }
  if (!existing && normalized.id) {
    existing = await table.get(normalized.id)
  }

  if (existing) {
    // Deterministic last-write-wins by (updatedAt, deviceId). A locally-newer
    // PENDING edit (higher updatedAt) is preserved — the server version is only
    // applied when it wins the comparison, so unsynced local edits are never
    // clobbered by an older server record.
    if (compareAuthorship(normalized, existing) >= 0) {
      await table.put({
        ...normalized,
        id: existing.id,
      })
    }
  } else {
    await table.put(normalized)
  }
}
