/**
 * User Database - Dexie/IndexedDB
 * Contains user-specific data that syncs with MongoDB
 * CLEARED ON LOGOUT
 */

import Dexie, { type Table } from "dexie"
import type { Flight } from "@/types/entities/flight.types"
import type { Crew } from "@/types/entities/crew.types"
import type { UserAircraft } from "@/types/entities/aircraft.types"
import type { LocalSession } from "@/types/entities/user.types"
import type { SyncQueueItem, SyncMeta, UserPreference } from "@/types/infrastructure/db.types"

class UserDatabase extends Dexie {
  flights!: Table<Flight, string>
  crew!: Table<Crew, string>
  aircraft!: Table<UserAircraft, string>
  sessions!: Table<LocalSession, string>
  preferences!: Table<UserPreference, string>
  syncQueue!: Table<SyncQueueItem, string>
  syncMeta!: Table<SyncMeta, string>

  constructor() {
    super("PilotLogbook_User")

    this.version(1).stores({
      flights: "id, date, syncStatus, aircraftReg, mongoId, userId",
      crew: "id, name, syncStatus, mongoId, userId, isMe",
      aircraft: "id, registration, type, syncStatus, mongoId, userId",
      sessions: "id",
      preferences: "key",
      syncQueue: "id, collection, timestamp",
      syncMeta: "key",
    })
  }

  /**
   * Clear all user data on logout
   */
  async clearAllUserData(): Promise<void> {
    await Promise.all([
      this.flights.clear(),
      this.crew.clear(),
      this.aircraft.clear(),
      this.sessions.clear(),
      this.preferences.clear(),
      this.syncQueue.clear(),
      this.syncMeta.clear(),
    ])
  }
}

export const userDb = new UserDatabase()

/**
 * Initialize user database
 */
export async function initializeUserDb(): Promise<boolean> {
  try {
    const openPromise = userDb.open()
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("UserDB open timeout")), 10000),
    )
    await Promise.race([openPromise, timeoutPromise])
    console.log("[UserDB] Initialized successfully")
    return true
  } catch (error) {
    console.error("[UserDB] Failed to initialize:", error)
    return false
  }
}
