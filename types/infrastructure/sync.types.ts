/**
 * Sync infrastructure type definitions
 */

import type { Flight } from "../entities/flight.types"
import type { Crew } from "../entities/crew.types"
import type { UserAircraft } from "../entities/aircraft.types"

export type SyncStatus = "online" | "offline" | "syncing"

export type SyncCollection = "flights" | "aircraft" | "crew"

/**
 * Sync queue operation types
 */
export type SyncOperation = "create" | "update" | "delete"

/**
 * Sync push request payload
 */
export interface SyncPushPayload {
  id: string
  type: SyncOperation
  timestamp: number
  collection: SyncCollection
  data: Flight | Crew | UserAircraft | { id: string; mongoId?: string }
}

/**
 * Sync push response
 */
export interface SyncPushResponse {
  success: boolean
  mongoId?: string
  rejected?: boolean
  reason?: string
}

/**
 * Sync pull response
 */
export interface SyncPullResponse<T> {
  records: T[]
  deletions: string[]
  requiresFullResync?: boolean
  reason?: string
}

/**
 * Full sync result
 */
export interface SyncResult {
  pushed: number
  pulled: number
  failed: number
}

/**
 * Sync listener callback
 */
export type SyncStatusListener = (status: SyncStatus) => void

/**
 * Data changed callback
 */
export type DataChangedListener = () => void
