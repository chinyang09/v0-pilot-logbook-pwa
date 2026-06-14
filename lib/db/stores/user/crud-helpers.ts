/**
 * Generic CRUD helper functions for store operations
 * Reduces code duplication across entity stores
 */

import type { Table } from "dexie"
import { addToSyncQueue, getDeviceId } from "./sync-queue.store"

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
export type SyncableTableName = "flights" | "personnel" | "aircraft"

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
 * Generic delete operation for syncable entities
 */
export async function deleteEntity<T extends SyncableEntity>(
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

/**
 * Create timestamps for a new entity
 */
export function createTimestamps(includeUpdatedAt = true): { createdAt: number; updatedAt?: number } {
  const now = Date.now()
  return {
    createdAt: now,
    ...(includeUpdatedAt && { updatedAt: now }),
  }
}

/**
 * Create update timestamp
 */
export function updateTimestamp(): { updatedAt: number } {
  return { updatedAt: Date.now() }
}
