/**
 * API response type definitions
 */

import type { Flight } from "../entities/flight.types"
import type { Crew } from "../entities/crew.types"
import type { UserAircraft } from "../entities/aircraft.types"

/**
 * Generic API response
 */
export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
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
export interface SyncPullResponse {
  records: (Flight | Crew | UserAircraft)[]
  deletions: string[]
  requiresFullResync?: boolean
  reason?: string
}

/**
 * Auth session response
 */
export interface AuthSessionResponse {
  authenticated: boolean
  userId?: string
  callsign?: string
  expiresAt?: number
  recoveryLogin?: boolean
}

/**
 * Auth login response
 */
export interface AuthLoginResponse {
  success: boolean
  sessionToken: string
  userId: string
  callsign: string
  expiresAt: number
  recoveryLogin?: boolean
}

/**
 * Passkey list response
 */
export interface PasskeyListResponse {
  passkeys: Array<{
    id: string
    name?: string
    createdAt: number
    deviceType: string
    backedUp: boolean
  }>
}
