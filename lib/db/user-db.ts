/**
 * User-specific database (cleared on logout)
 *
 * Contains all user-owned data that syncs with MongoDB:
 * - Flights
 * - Aircraft
 * - Personnel
 * - Preferences
 * - Sync queue
 * - Session
 */

import Dexie, { type Table } from "dexie"
import type { FlightLog } from "@/types/entities/flight.types"
import type { Aircraft } from "@/types/entities/aircraft.types"
import type { Personnel } from "@/types/entities/crew.types"
import type { UserSession } from "@/types/entities/user.types"
import type { UserPreferences } from "@/types/db/stores.types"
import type { SyncQueueItem, SyncMeta } from "@/types/sync/sync.types"
import type { ScheduleEntry, Currency, Discrepancy } from "@/types/entities/roster.types"

class UserDatabase extends Dexie {
  flights!: Table<FlightLog, string>
  aircraft!: Table<Aircraft, string>
  personnel!: Table<Personnel, string>
  preferences!: Table<UserPreferences, string>
  syncQueue!: Table<SyncQueueItem, string>
  syncMeta!: Table<SyncMeta, string>
  userSession!: Table<UserSession, string>

  // Roster tables
  scheduleEntries!: Table<ScheduleEntry, string>
  currencies!: Table<Currency, string>
  discrepancies!: Table<Discrepancy, string>

  constructor() {
    super("PilotLogbook_User")

    this.version(1).stores({
      flights: "id, date, syncStatus, aircraftReg, userId",
      aircraft: "id, registration, type, userId",
      personnel: "id, name, userId",
      preferences: "key",
      syncQueue: "id, collection, timestamp",
      syncMeta: "key",
      userSession: "id",
    })

    // Version 2: Add roster tables and flight/personnel indexes
    this.version(2).stores({
      flights: "id, date, syncStatus, aircraftReg, userId, flightNumber",
      aircraft: "id, registration, type, userId",
      personnel: "id, name, userId, crewId",
      preferences: "key",
      syncQueue: "id, collection, timestamp",
      syncMeta: "key",
      userSession: "id",
      // New roster tables
      scheduleEntries: "id, date, dutyType, syncStatus, [date+dutyType]",
      currencies: "id, code, expiryDate, syncStatus",
      discrepancies: "id, type, resolved, scheduleEntryId, flightLogId, createdAt",
    })

    // Version 3: Add reportGeneratedAt + importSource on flights for stale-report gatekeeping.
    // No upgrade body needed: both are optional, existing rows leave them undefined.
    this.version(3).stores({
      flights: "id, date, syncStatus, aircraftReg, userId, flightNumber, reportGeneratedAt",
      aircraft: "id, registration, type, userId",
      personnel: "id, name, userId, crewId",
      preferences: "key",
      syncQueue: "id, collection, timestamp",
      syncMeta: "key",
      userSession: "id",
      scheduleEntries: "id, date, dutyType, syncStatus, [date+dutyType]",
      currencies: "id, code, expiryDate, syncStatus",
      discrepancies: "id, type, resolved, scheduleEntryId, flightLogId, createdAt",
    })

    // Version 4 (additive): bring roster collections into sync.
    // - syncQueue gains a denormalized `recordId` + [collection+recordId] index
    //   so enqueue can dedup to one live row per record (bounds offline growth).
    // - aircraft/personnel/discrepancies gain a syncStatus index for pending scans.
    // The upgrade backfills `recordId` on existing queue rows from data.id.
    this.version(4)
      .stores({
        aircraft: "id, registration, type, userId, syncStatus",
        personnel: "id, name, userId, crewId, syncStatus",
        syncQueue: "id, collection, timestamp, [collection+recordId]",
        discrepancies:
          "id, type, resolved, scheduleEntryId, flightLogId, createdAt, syncStatus",
      })
      .upgrade(async (tx) => {
        await tx
          .table("syncQueue")
          .toCollection()
          .modify((row: { recordId?: string; data?: { id?: string } }) => {
            row.recordId = row?.data?.id
          })
      })
  }

  /**
   * Clear all user data (called on logout)
   */
  async clearAllUserData(): Promise<void> {
    await this.transaction(
      "rw",
      [
        this.flights,
        this.aircraft,
        this.personnel,
        this.preferences,
        this.syncQueue,
        this.syncMeta,
        this.userSession,
        this.scheduleEntries,
        this.currencies,
        this.discrepancies,
      ],
      async () => {
        await Promise.all([
          this.flights.clear(),
          this.aircraft.clear(),
          this.personnel.clear(),
          this.preferences.clear(),
          this.syncQueue.clear(),
          this.syncMeta.clear(),
          this.userSession.clear(),
          this.scheduleEntries.clear(),
          this.currencies.clear(),
          this.discrepancies.clear(),
        ])
      }
    )
  }

  /**
   * Clear all local data except preferences (for full resync)
   */
  async clearLocalDataForResync(): Promise<void> {
    await this.transaction(
      "rw",
      [
        this.flights,
        this.aircraft,
        this.personnel,
        this.syncQueue,
        this.syncMeta,
        this.scheduleEntries,
        this.currencies,
        this.discrepancies,
      ],
      async () => {
        await Promise.all([
          this.flights.clear(),
          this.aircraft.clear(),
          this.personnel.clear(),
          this.syncQueue.clear(),
          this.syncMeta.clear(),
          this.scheduleEntries.clear(),
          this.currencies.clear(),
          this.discrepancies.clear(),
        ])
      }
    )
    console.log("[UserDB] Cleared all local data for full resync")
  }

  /**
   * Clear data tables for a full resync while PRESERVING the sync queue and
   * sync metadata (device id, audit counters). Unpushed mutations are retained:
   * create/update queue rows carry the full record payload, so a record cleared
   * here is still re-pushed from its queue row and re-pulled from the server —
   * a full resync therefore never destroys un-synced local edits.
   */
  async clearDataTablesForResync(): Promise<void> {
    await this.transaction(
      "rw",
      [
        this.flights,
        this.aircraft,
        this.personnel,
        this.scheduleEntries,
        this.currencies,
        this.discrepancies,
      ],
      async () => {
        await Promise.all([
          this.flights.clear(),
          this.aircraft.clear(),
          this.personnel.clear(),
          this.scheduleEntries.clear(),
          this.currencies.clear(),
          this.discrepancies.clear(),
        ])
      }
    )
    console.log("[UserDB] Cleared data tables for full resync (queue preserved)")
  }
}

export const userDb = new UserDatabase()

/**
 * Initialize the user database
 */
export async function initializeUserDB(): Promise<boolean> {
  try {
    const openPromise = userDb.open()
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("User database open timeout")), 10000)
    )

    await Promise.race([openPromise, timeoutPromise])
    console.log("[UserDB] Database initialized successfully")
    return true
  } catch (error) {
    console.error("[UserDB] Failed to initialize:", error)
    return false
  }
}
