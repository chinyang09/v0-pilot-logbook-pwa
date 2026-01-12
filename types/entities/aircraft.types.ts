/**
 * Aircraft entity type definitions
 *
 * Two types of aircraft data:
 * 1. UserAircraft - USER DATA that syncs with MongoDB (aircraft the user has flown)
 * 2. ReferenceAircraft - REFERENCE DATA from CDN (global aircraft database)
 */

import type { SyncStatus } from "./flight.types"

export type EngineType = "SEP" | "MEP" | "SET" | "MET" | "JET"

/**
 * User's aircraft - syncs with MongoDB
 */
export interface UserAircraft {
  id: string // ULID - domain identity
  userId: string // Owner's user ID

  registration: string
  type: string
  typeDesignator: string
  model: string
  category: string
  engineType: EngineType
  isComplex: boolean
  isHighPerformance: boolean

  // Metadata
  createdAt: number
  updatedAt?: number
  syncStatus: SyncStatus
  mongoId?: string
}

export type UserAircraftInput = Omit<UserAircraft, "id" | "createdAt" | "syncStatus">
export type UserAircraftUpdate = Partial<Omit<UserAircraft, "id" | "userId" | "createdAt">>

/**
 * Reference aircraft from CDN - read-only, no sync
 */
export interface ReferenceAircraft {
  icao24: string // Primary key - hex transponder code
  registration: string | null
  typecode: string | null // ICAO type designator
  shortType: string | null // Short type name
}

/**
 * Normalized aircraft for display
 */
export interface NormalizedAircraft {
  registration: string
  icao24: string
  typecode: string
  shortType: string
}

/**
 * Raw aircraft data from CDN (NDJSON format)
 */
export interface RawAircraftData {
  icao24: string
  reg: string | null
  icaotype: string | null
  short_type: string | null
}
