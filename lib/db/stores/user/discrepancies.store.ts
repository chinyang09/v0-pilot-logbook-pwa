/**
 * Discrepancy store operations
 */

import { userDb } from "../../user-db"
import type {
  Discrepancy,
  DiscrepancyCreate,
  DiscrepancyType,
} from "@/types/entities/roster.types"
import { addToSyncQueue, enqueueMany, getDeviceId } from "./sync-queue.store"
import { updateEntity, deleteEntity, silentDeleteEntity, upsertFromServer } from "./crud-helpers"
import { isWithinRetention } from "@/lib/utils/retention"

/**
 * Add new discrepancy
 */
export async function addDiscrepancy(discrepancy: DiscrepancyCreate): Promise<Discrepancy> {
  const newDiscrepancy: Discrepancy = {
    ...discrepancy,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deviceId: await getDeviceId(),
    syncStatus: "pending",
  }

  await userDb.discrepancies.put(newDiscrepancy)
  await addToSyncQueue("create", "discrepancies", newDiscrepancy)
  return newDiscrepancy
}

/**
 * Bulk add discrepancies
 */
export async function bulkAddDiscrepancies(
  discrepancies: DiscrepancyCreate[]
): Promise<Discrepancy[]> {
  const now = Date.now()
  const deviceId = await getDeviceId()
  const newDiscrepancies: Discrepancy[] = discrepancies.map((d) => ({
    ...d,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    deviceId,
    syncStatus: "pending",
  }))

  await userDb.discrepancies.bulkPut(newDiscrepancies)
  await enqueueMany(
    newDiscrepancies.map((data) => ({ type: "create" as const, collection: "discrepancies" as const, data }))
  )
  return newDiscrepancies
}

/**
 * Get discrepancy by ID
 */
export async function getDiscrepancyById(id: string): Promise<Discrepancy | undefined> {
  return userDb.discrepancies.get(id)
}

/**
 * Resolve discrepancy
 */
export async function resolveDiscrepancy(
  id: string,
  resolution: Discrepancy["resolvedBy"],
  notes?: string
): Promise<Discrepancy | null> {
  return updateEntity<Discrepancy>(userDb.discrepancies, "discrepancies", id, {
    resolved: true,
    resolvedAt: Date.now(),
    resolvedBy: resolution,
    resolutionNotes: notes,
  })
}

/**
 * Unresolve discrepancy (reopen)
 */
export async function unresolveDiscrepancy(id: string): Promise<Discrepancy | null> {
  return updateEntity<Discrepancy>(userDb.discrepancies, "discrepancies", id, {
    resolved: false,
    resolvedAt: undefined,
    resolvedBy: undefined,
    resolutionNotes: undefined,
  })
}

/**
 * Take one side of a pilot-vs-company comparison.
 *
 * Taking the COMPANY's value starts the undo clock: the row leaves the standing
 * comparisons and is retained for 90 days holding the pilot's original value,
 * after which it is purged and the change can no longer be put back. Taking
 * (or going back to) the PILOT's value clears the clock — the difference is a
 * standing one again, and those are kept indefinitely because a licence
 * submission is checked against them.
 */
export async function setDiscrepancyHolding(
  id: string,
  holding: "logbook" | "schedule"
): Promise<Discrepancy | null> {
  return updateEntity<Discrepancy>(userDb.discrepancies, "discrepancies", id, {
    holding,
    acceptedAt: holding === "schedule" ? Date.now() : undefined,
  })
}

/**
 * Drop accepted comparisons whose 90-day undo window has closed.
 *
 * This is the point at which the original value is really gone — the row is the
 * only place it was kept. Rows still holding the pilot's own value are never
 * touched: nothing was overwritten, so there is nothing to expire.
 *
 * Deleted through the normal path so the removal propagates to other devices
 * rather than reappearing on the next pull. Returns how many went.
 */
export async function purgeExpiredAcceptedDiscrepancies(
  now = Date.now()
): Promise<number> {
  const expired = await userDb.discrepancies
    .filter(
      (d: Discrepancy) =>
        d.acceptedAt !== undefined && !isWithinRetention(d.acceptedAt, now)
    )
    .toArray()

  for (const d of expired) {
    await deleteEntity<Discrepancy>(userDb.discrepancies, "discrepancies", d.id)
  }
  return expired.length
}

/**
 * Get all discrepancies
 */
export async function getAllDiscrepancies(): Promise<Discrepancy[]> {
  return userDb.discrepancies.orderBy("createdAt").reverse().toArray()
}

/**
 * Get unresolved discrepancies
 */
export async function getUnresolvedDiscrepancies(): Promise<Discrepancy[]> {
  return userDb.discrepancies.filter((d: Discrepancy) => !d.resolved).toArray()
}

/**
 * Get resolved discrepancies
 */
export async function getResolvedDiscrepancies(): Promise<Discrepancy[]> {
  return userDb.discrepancies.filter((d: Discrepancy) => d.resolved).toArray()
}

/**
 * Get discrepancies by type
 */
export async function getDiscrepanciesByType(type: DiscrepancyType): Promise<Discrepancy[]> {
  return userDb.discrepancies.where("type").equals(type).toArray()
}

/**
 * Get discrepancies by schedule entry ID
 */
export async function getDiscrepanciesByScheduleEntry(
  scheduleEntryId: string
): Promise<Discrepancy[]> {
  return userDb.discrepancies
    .where("scheduleEntryId")
    .equals(scheduleEntryId)
    .toArray()
}

/**
 * Get discrepancies by flight log ID
 */
export async function getDiscrepanciesByFlightLog(flightLogId: string): Promise<Discrepancy[]> {
  return userDb.discrepancies.where("flightLogId").equals(flightLogId).toArray()
}

/**
 * Delete discrepancy
 */
export async function deleteDiscrepancy(id: string): Promise<boolean> {
  return deleteEntity<Discrepancy>(userDb.discrepancies, "discrepancies", id)
}

/**
 * Delete discrepancy without enqueuing (server-initiated)
 */
export async function silentDeleteDiscrepancy(id: string): Promise<boolean> {
  return silentDeleteEntity<Discrepancy>(userDb.discrepancies, id)
}

/**
 * Normalize a server discrepancy record.
 */
function normalizeDiscrepancyFromServer(server: Discrepancy): Discrepancy {
  return {
    ...server,
    resolved: server.resolved ?? false,
    createdAt: server.createdAt || Date.now(),
    updatedAt: server.updatedAt,
    syncStatus: "synced",
  }
}

/**
 * Upsert a discrepancy from server (for sync)
 */
export async function upsertDiscrepancyFromServer(server: Discrepancy): Promise<void> {
  return upsertFromServer<Discrepancy>(userDb.discrepancies, server, normalizeDiscrepancyFromServer)
}

/**
 * Clear all discrepancies
 */
export async function clearAllDiscrepancies(): Promise<void> {
  await userDb.discrepancies.clear()
}

/**
 * Get discrepancies count
 */
export async function getDiscrepanciesCount(): Promise<{
  total: number
  unresolved: number
  resolved: number
}> {
  const all = await userDb.discrepancies.toArray()
  const unresolved = all.filter((d: Discrepancy) => !d.resolved).length
  return {
    total: all.length,
    unresolved,
    resolved: all.length - unresolved,
  }
}

/**
 * Get discrepancies by severity
 */
export async function getDiscrepanciesBySeverity(
  severity: "info" | "warning" | "error"
): Promise<Discrepancy[]> {
  return userDb.discrepancies.filter((d: Discrepancy) => d.severity === severity).toArray()
}
