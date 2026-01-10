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

class UserDatabase extends Dexie {
  flights!: Table<FlightLog, string>
  aircraft!: Table<Aircraft, string>
  personnel!: Table<Personnel, string>
  preferences!: Table<UserPreferences, string>
  syncQueue!: Table<SyncQueueItem, string>
  syncMeta!: Table<SyncMeta, string>
  userSession!: Table<UserSession, string>

  constructor() {
    super("PilotLogbook_User")

    this.version(1).stores({
      flights: "id, date, syncStatus, aircraftReg, mongoId, userId",
      aircraft: "id, registration, type, mongoId, userId",
      personnel: "id, name, mongoId, userId",
      preferences: "key",
      syncQueue: "id, collection, timestamp",
      syncMeta: "key",
      userSession: "id",
    })
  }

  /**
   * Clear all user data (called on logout)
   */
  async clearAllUserData(): Promise<void> {
    await this.transaction(
      "rw",
      [this.flights, this.aircraft, this.personnel, this.syncQueue, this.syncMeta, this.userSession],
      async () => {
        await Promise.all([
          this.flights.clear(),
          this.aircraft.clear(),
          this.personnel.clear(),
          this.syncQueue.clear(),
          this.syncMeta.clear(),
          this.userSession.clear(),
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
      [this.flights, this.aircraft, this.personnel, this.syncQueue, this.syncMeta],
      async () => {
        await Promise.all([
          this.flights.clear(),
          this.aircraft.clear(),
          this.personnel.clear(),
          this.syncQueue.clear(),
          this.syncMeta.clear(),
        ])
      }
    )
    console.log("[UserDB] Cleared all local data for full resync")
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
