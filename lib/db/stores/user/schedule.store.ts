/**
 * Schedule Entry store operations
 */

import { userDb } from "../../user-db"
import type {
  ScheduleEntry,
  ScheduleEntryCreate,
  DutyType,
} from "@/types/entities/roster.types"
import { addToSyncQueue } from "./sync-queue.store"

/**
 * Add new schedule entry
 */
export async function addScheduleEntry(entry: ScheduleEntryCreate): Promise<ScheduleEntry> {
  const newEntry: ScheduleEntry = {
    ...entry,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    syncStatus: "pending",
  }

  await userDb.scheduleEntries.put(newEntry)
  // Note: Schedule entries are local-only for now, not synced to server
  // await addToSyncQueue("create", "scheduleEntries", newEntry)

  return newEntry
}

/**
 * Update existing schedule entry
 */
export async function updateScheduleEntry(
  id: string,
  updates: Partial<ScheduleEntry>
): Promise<ScheduleEntry | null> {
  const entry = await userDb.scheduleEntries.get(id)
  if (!entry) return null

  const updatedEntry: ScheduleEntry = {
    ...entry,
    ...updates,
    updatedAt: Date.now(),
  }

  await userDb.scheduleEntries.put(updatedEntry)
  return updatedEntry
}

/**
 * Delete schedule entry
 */
export async function deleteScheduleEntry(id: string): Promise<boolean> {
  const entry = await userDb.scheduleEntries.get(id)
  if (!entry) return false

  await userDb.scheduleEntries.delete(id)
  return true
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
  const entry = await userDb.scheduleEntries.get(entryId)
  if (!entry) return

  await userDb.scheduleEntries.update(entryId, {
    linkedFlightIds: flightIds,
    updatedAt: Date.now(),
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

  await userDb.transaction("rw", [userDb.scheduleEntries], async () => {
    for (const entry of entries) {
      const existing = await userDb.scheduleEntries
        .where("date")
        .equals(entry.date)
        .filter((e: ScheduleEntry) => e.dutyCode === entry.dutyCode)
        .first()

      if (existing) {
        await userDb.scheduleEntries.update(existing.id, {
          ...entry,
          updatedAt: Date.now(),
        })
        updated++
      } else {
        await userDb.scheduleEntries.add({
          ...entry,
          id: crypto.randomUUID(),
          createdAt: Date.now(),
          syncStatus: "pending",
        })
        created++
      }
    }
  })

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
