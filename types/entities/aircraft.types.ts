/**
 * Aircraft-related type definitions
 */

import type { SyncStatus } from "./flight.types"

export type EngineType = "SEP" | "MEP" | "SET" | "MET" | "JET"

/**
 * User-owned aircraft (syncs with MongoDB)
 */
export interface Aircraft {
  id: string
  userId?: string
  registration: string
  type: string
  typeDesignator: string
  model: string
  category: string
  engineType: EngineType
  isComplex: boolean
  isHighPerformance: boolean
  createdAt: number
  updatedAt?: number
  syncStatus: SyncStatus
  mongoId?: string
}

export type AircraftCreate = Omit<Aircraft, "id" | "createdAt" | "syncStatus">
export type AircraftUpdate = Partial<Aircraft>

/**
 * Reference aircraft data from CDN (read-only, no sync)
 */
export interface AircraftReference {
  registration: string
  data: string // JSON string with aircraft details
}
