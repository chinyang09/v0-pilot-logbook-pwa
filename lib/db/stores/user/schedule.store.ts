/**
 * Schedule Entry store operations
 */

import { userDb } from "../../user-db"
import type {
  ScheduleEntry,
  ScheduleEntryCreate,
  DutyType,
} from "@/types/entities/roster.types"
import { addToSyncQueue, enqueueMany, getDeviceId } from "./sync-queue.store"
import {
  updateEntity,
  deleteEntity,
  restoreEntity,
  purgeEntity,
  purgeExpiredEntities,
  silentDeleteEntity,
  upsertFromServer,
  isLiveEntity,
} from "./crud-helpers"

/**
 * Add new schedule entry
 */
export async function addScheduleEntry(entry: ScheduleEntryCreate): Promise<ScheduleEntry> {
  const newEntry: ScheduleEntry = {
    ...entry,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deviceId: await getDeviceId(),
    syncStatus: "pending",
  }

  await userDb.scheduleEntries.put(newEntry)
  await addToSyncQueue("create", "scheduleEntries", newEntry)

  return newEntry
}

/**
 * Update existing schedule entry
 */
export async function updateScheduleEntry(
  id: string,
  updates: Partial<ScheduleEntry>
): Promise<ScheduleEntry | null> {
  return updateEntity<ScheduleEntry>(userDb.scheduleEntries, "scheduleEntries", id, updates)
}

/**
 * Delete a schedule entry — SOFT, into Recently Deleted.
 *
 * This used to be a hard delete, on the reasoning that schedule rows are
 * import bookkeeping the next report regenerates wholesale, so a holding area
 * for them would only be noise. That held while the roster was import-only.
 * It stopped holding the moment duties became hand-editable: a standby you
 * typed in yourself is a record you authored, and a mis-tap on it should be as
 * recoverable as a mis-tap on a flight.
 */
export async function deleteScheduleEntry(id: string): Promise<boolean> {
  return deleteEntity<ScheduleEntry>(userDb.scheduleEntries, "scheduleEntries", id)
}

/** Take a schedule entry back out of Recently Deleted. */
export async function restoreScheduleEntry(id: string): Promise<boolean> {
  return restoreEntity<ScheduleEntry>(userDb.scheduleEntries, "scheduleEntries", id)
}

/** Delete a schedule entry for good, tombstone and all. */
export async function purgeScheduleEntry(id: string): Promise<boolean> {
  return purgeEntity<ScheduleEntry>(userDb.scheduleEntries, "scheduleEntries", id)
}

/** Destroy schedule entries whose 30-day holding period has run out. */
export async function purgeExpiredDeletedScheduleEntries(now = Date.now()): Promise<number> {
  return purgeExpiredEntities<ScheduleEntry>(
    userDb.scheduleEntries,
    "scheduleEntries",
    now
  )
}

/** The binned entries, for Recently Deleted. */
export async function getDeletedScheduleEntries(): Promise<ScheduleEntry[]> {
  const all = await userDb.scheduleEntries.orderBy("date").toArray()
  return all.filter((e) => !isLiveEntity(e))
}

/**
 * Delete schedule entry without enqueuing (server-initiated)
 */
export async function silentDeleteScheduleEntry(id: string): Promise<boolean> {
  return silentDeleteEntity<ScheduleEntry>(userDb.scheduleEntries, id)
}

/**
 * Get all schedule entries
 */
export async function getAllScheduleEntries(): Promise<ScheduleEntry[]> {
  const all = await userDb.scheduleEntries.orderBy("date").toArray()
  return all.filter(isLiveEntity)
}

/**
 * Get schedule entry by ID
 */
export async function getScheduleEntryById(id: string): Promise<ScheduleEntry | undefined> {
  return userDb.scheduleEntries.get(id)
}

/**
 * Get schedule entries by date range
 */
export async function getScheduleEntriesByDateRange(
  startDate: string,
  endDate: string
): Promise<ScheduleEntry[]> {
  const rows = await userDb.scheduleEntries
    .where("date")
    .between(startDate, endDate, true, true)
    .toArray()
  return rows.filter(isLiveEntity)
}

/**
 * Get schedule entries by date
 */
export async function getScheduleEntriesByDate(date: string): Promise<ScheduleEntry[]> {
  const rows = await userDb.scheduleEntries.where("date").equals(date).toArray()
  return rows.filter(isLiveEntity)
}

/**
 * Get schedule entries by duty type
 */
export async function getScheduleEntriesByDutyType(dutyType: DutyType): Promise<ScheduleEntry[]> {
  const rows = await userDb.scheduleEntries.where("dutyType").equals(dutyType).toArray()
  return rows.filter(isLiveEntity)
}

/**
 * Get flight schedule entries (for draft generation)
 */
export async function getFlightScheduleEntries(): Promise<ScheduleEntry[]> {
  const rows = await userDb.scheduleEntries.where("dutyType").equals("flight").toArray()
  return rows.filter(isLiveEntity)
}

/**
 * Get unlinked flight schedule entries (no drafts created yet)
 */
export async function getUnlinkedFlightEntries(): Promise<ScheduleEntry[]> {
  const rows = await userDb.scheduleEntries
    .where("dutyType")
    .equals("flight")
    .filter((e: ScheduleEntry) => !e.linkedFlightIds || e.linkedFlightIds.length === 0)
    .toArray()
  return rows.filter(isLiveEntity)
}

/**
 * Link flights to schedule entry
 */
export async function linkFlightsToScheduleEntry(
  entryId: string,
  flightIds: string[]
): Promise<void> {
  await updateEntity<ScheduleEntry>(userDb.scheduleEntries, "scheduleEntries", entryId, {
    linkedFlightIds: flightIds,
  })
}

/**
 * Bulk upsert schedule entries
 */
export async function bulkUpsertScheduleEntries(
  entries: ScheduleEntryCreate[]
): Promise<{
  created: number
  updated: number
}> {
  let created = 0
  let updated = 0
  const deviceId = await getDeviceId()
  const toEnqueue: { type: "create" | "update"; collection: "scheduleEntries"; data: ScheduleEntry }[] = []

  await userDb.transaction("rw", [userDb.scheduleEntries], async () => {
    for (const entry of entries) {
      // A BINNED row must not be matched. Updating one would silently
      // resurrect a duty the user deleted — the same rule the flight
      // reconciler follows. A re-import re-creates it instead, which is right:
      // if the company report still carries the duty, the report is the
      // authority on whether it exists.
      const existing = await userDb.scheduleEntries
        .where("date")
        .equals(entry.date)
        .filter((e: ScheduleEntry) => e.dutyCode === entry.dutyCode && isLiveEntity(e))
        .first()

      if (existing) {
        const merged: ScheduleEntry = {
          ...existing,
          ...entry,
          updatedAt: Date.now(),
          deviceId,
          syncStatus: "pending",
        }
        await userDb.scheduleEntries.put(merged)
        toEnqueue.push({ type: "update", collection: "scheduleEntries", data: merged })
        updated++
      } else {
        const newEntry: ScheduleEntry = {
          ...entry,
          id: crypto.randomUUID(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          deviceId,
          syncStatus: "pending",
        }
        await userDb.scheduleEntries.add(newEntry)
        toEnqueue.push({ type: "create", collection: "scheduleEntries", data: newEntry })
        created++
      }
    }
  })

  // Enqueue AFTER the data transaction commits (syncQueue is a separate table).
  await enqueueMany(toEnqueue)

  return { created, updated }
}

/**
 * Clear all schedule entries
 */
export async function clearAllScheduleEntries(): Promise<void> {
  await userDb.scheduleEntries.clear()
}

/**
 * Get schedule entries count
 */
export async function getScheduleEntriesCount(): Promise<number> {
  const all = await userDb.scheduleEntries.toArray()
  return all.filter(isLiveEntity).length
}

/**
 * Get schedule date range
 */
export async function getScheduleDateRange(): Promise<{ start: string; end: string } | null> {
  const entries = (await userDb.scheduleEntries.orderBy("date").toArray()).filter(
    isLiveEntity
  )
  if (entries.length === 0) return null

  return {
    start: entries[0].date,
    end: entries[entries.length - 1].date,
  }
}

/**
 * Normalize a server schedule entry (fill required defaults).
 */
function normalizeScheduleEntryFromServer(server: ScheduleEntry): ScheduleEntry {
  return {
    ...server,
    sectors: server.sectors || [],
    crew: server.crew || [],
    importedAt: server.importedAt || server.createdAt || Date.now(),
    createdAt: server.createdAt || Date.now(),
    updatedAt: server.updatedAt,
    syncStatus: "synced",
  }
}

/**
 * Upsert a schedule entry from server (for sync)
 */
export async function upsertScheduleEntryFromServer(server: ScheduleEntry): Promise<void> {
  return upsertFromServer<ScheduleEntry>(
    userDb.scheduleEntries,
    server,
    normalizeScheduleEntryFromServer
  )
}
