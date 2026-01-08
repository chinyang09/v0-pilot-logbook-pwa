/**
 * Core Dexie Database Definition
 * Single source of truth for all IndexedDB tables
 */
import Dexie, { type Table } from "dexie"

// Import all domain types
import type { FlightLog } from "../flight/flight-types"
import type { Aircraft } from "../aircraft/aircraft-types"
import type { Airport } from "../airport/airport-types"
import type { Personnel } from "../personnel/personnel-types"
import type { UserSession, UserPreferences, SyncQueueItem, SyncMeta, AircraftCacheEntry } from "./core-types"

// Re-export types for convenience
export type { FlightLog, Approach, AdditionalCrew } from "../flight/flight-types"
export type { Aircraft } from "../aircraft/aircraft-types"
export type { Airport } from "../airport/airport-types"
export type { Personnel } from "../personnel/personnel-types"
export type { UserSession, UserPreferences, SyncQueueItem, SyncMeta, AircraftCacheEntry } from "./core-types"

class PilotLogbookDB extends Dexie {
  flights!: Table<FlightLog, string>
  aircraft!: Table<Aircraft, string>
  airports!: Table<Airport, string>
  personnel!: Table<Personnel, string>
  preferences!: Table<UserPreferences, string>
  syncQueue!: Table<SyncQueueItem, string>
  syncMeta!: Table<SyncMeta, string>
  aircraftDatabase!: Table<AircraftCacheEntry, string>
  userSession!: Table<UserSession, string>

  constructor() {
    super("pilot-logbook")

    this.version(9).stores({
      flights: "id, date, syncStatus, aircraftReg, mongoId, userId",
      aircraft: "id, registration, type, mongoId, userId",
      airports: "icao, iata, name, id, isFavorite",
      personnel: "id, name, mongoId, userId",
      preferences: "key",
      syncQueue: "id, collection, timestamp",
      syncMeta: "key",
      aircraftDatabase: "registration",
      userSession: "id",
    })
  }
}

export const db = new PilotLogbookDB()

export async function initializeDB(): Promise<boolean> {
  try {
    const openPromise = db.open()
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("IndexedDB open timeout")), 10000),
    )
    await Promise.race([openPromise, timeoutPromise])
    return true
  } catch (error) {
    console.error("[DB] Failed to initialize IndexedDB:", error)
    return false
  }
}

export async function getDB(): Promise<PilotLogbookDB> {
  return db
}
