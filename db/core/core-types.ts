/**
 * Core types for database infrastructure
 * Session, preferences, sync queue, etc.
 */
import type { FlightLog } from "../flight/flight-types"
import type { Aircraft } from "../aircraft/aircraft-types"
import type { Personnel } from "../personnel/personnel-types"

export interface UserSession {
  id: string // Always "current"
  userId: string // The user's ID from MongoDB
  callsign: string
  sessionToken: string
  expiresAt: number
  createdAt: number
}

export interface UserPreferences {
  key: string // Always "user-prefs"
  fieldOrder: {
    flight: string[]
    time: string[]
    crew: string[]
    landings: string[]
    approaches: string[]
    notes: string[]
  }
  visibleFields: Record<string, boolean>
  recentlyUsedAirports: string[]
  recentlyUsedAircraft: string[]
  createdAt: number
  updatedAt: number
}

export interface SyncQueueItem {
  id: string
  type: "create" | "update" | "delete"
  timestamp: number
  collection: "flights" | "aircraft" | "personnel"
  data: FlightLog | Aircraft | Personnel | { id: string; mongoId?: string }
}

export interface SyncMeta {
  key: string
  lastSyncAt: number
}

export interface AircraftCacheEntry {
  registration: string
  data: string
}
