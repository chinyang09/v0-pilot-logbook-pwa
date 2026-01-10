/**
 * Dexie/IndexedDB infrastructure types
 */

import type { FlightLog } from "../entities/flight.types"
import type { Aircraft, AircraftReference } from "../entities/aircraft.types"
import type { Airport } from "../entities/airport.types"
import type { Personnel } from "../entities/crew.types"
import type { UserSession } from "../entities/user.types"
import type { UserPreferences } from "./stores.types"
import type { SyncQueueItem, SyncMeta } from "../sync/sync.types"

/**
 * User database table types (cleared on logout)
 */
export interface UserDatabaseTables {
  flights: FlightLog
  aircraft: Aircraft
  personnel: Personnel
  preferences: UserPreferences
  syncQueue: SyncQueueItem
  syncMeta: SyncMeta
  userSession: UserSession
}

/**
 * Reference database table types (persists across sessions)
 */
export interface ReferenceDatabaseTables {
  airports: Airport
  aircraftDatabase: AircraftReference
  metadata: { key: string; value: any }
}
