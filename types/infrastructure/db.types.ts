/**
 * Database infrastructure type definitions
 */

import type { Flight } from "../entities/flight.types"
import type { Crew } from "../entities/crew.types"
import type { UserAircraft } from "../entities/aircraft.types"
import type { Airport } from "../entities/airport.types"
import type { LocalSession } from "../entities/user.types"

/**
 * Dexie table types for user database
 */
export interface UserDbSchema {
  flights: Flight
  crew: Crew
  aircraft: UserAircraft
  sessions: LocalSession
  preferences: UserPreference
  syncQueue: SyncQueueItem
  syncMeta: SyncMeta
}

/**
 * Dexie table types for reference database
 */
export interface ReferenceDbSchema {
  airports: Airport
  aircraftCache: AircraftCacheEntry
  metadata: RefMetadata
}

/**
 * User preference stored in IndexedDB
 */
export interface UserPreference {
  key: string
  value: unknown
}

/**
 * Sync queue item for offline-first sync
 */
export interface SyncQueueItem {
  id: string
  type: "create" | "update" | "delete"
  timestamp: number
  collection: "flights" | "aircraft" | "crew"
  data: Flight | Crew | UserAircraft | { id: string; mongoId?: string }
  retryCount?: number
}

/**
 * Sync metadata
 */
export interface SyncMeta {
  key: string
  lastSyncAt: number
}

/**
 * Aircraft cache entry from CDN
 */
export interface AircraftCacheEntry {
  registration: string // Primary key (icao24)
  data: string // JSON string of RawAircraftData
}

/**
 * Reference data metadata
 */
export interface RefMetadata {
  key: string
  value: unknown
}
