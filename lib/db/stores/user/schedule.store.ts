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
import { updateEntity, deleteEntity, silentDeleteEntity, upsertFromServer } from "./crud-helpers"

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
 * Delete schedule entry
 */
export async function deleteScheduleEntry(id: string): Promise<boolean> {
  return deleteEntity<ScheduleEntry>(userDb.scheduleEntries, "scheduleEntries", id)
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
  return userDb.scheduleEntries.orderBy("date").toArray()
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
  return userDb.scheduleEntries
    .where("date")
    .between(startDate, endDate, true, true)
    .toArray()
}

/**
 * Get schedule entries by date
 */
export async function getScheduleEntriesByDate(date: string): Promise<ScheduleEntry[]> {
  return userDb.scheduleEntries.where("date").equals(date).toArray()
}

/**
 * Get schedule entries by duty type
 */
export async function getScheduleEntriesByDutyType(dutyType: DutyType): Promise<ScheduleEntry[]> {
  return userDb.scheduleEntries.where("dutyType").equals(dutyType).toArray()
}

/**
 * Get flight schedule entries (for draft generation)
 */
export async function getFlightScheduleEntries(): Promise<ScheduleEntry[]> {
  return userDb.scheduleEntries.where("dutyType").equals("flight").toArray()
}

/**
 * Get unlinked flight schedule entries (no drafts created yet)
 */
export async function getUnlinkedFlightEntries(): Promise<ScheduleEntry[]> {
  return userDb.scheduleEntries
    .where("dutyType")
    .equals("flight")
    .filter((e: ScheduleEntry) => !e.linkedFlightIds || e.linkedFlightIds.length === 0)
    .toArray()
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
      const existing = await userDb.scheduleEntries
        .where("date")
        .equals(entry.date)
        .filter((e: ScheduleEntry) => e.dutyCode === entry.dutyCode)
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
  return userDb.scheduleEntries.count()
}

/**
 * Get schedule date range
 */
export async function getScheduleDateRange(): Promise<{ start: string; end: string } | null> {
  const entries = await userDb.scheduleEntries.orderBy("date").toArray()
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
