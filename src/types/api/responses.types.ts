/**
 * API response types
 */

import type { FlightLog } from "../entities/flight.types"
import type { Aircraft } from "../entities/aircraft.types"
import type { Personnel } from "../entities/crew.types"

export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface SyncPushResponse {
  success: boolean
  results: Array<{
    localId: string
    mongoId: string
    success: boolean
    error?: string
  }>
}

export interface SyncPullResponse {
  success: boolean
  data: Array<FlightLog | Aircraft | Personnel>
  deletedIds?: string[]
  serverTime: number
}

export interface AuthResponse {
  success: boolean
  user?: {
    id: string
    callsign: string
  }
  session?: {
    token: string
    expiresAt: string
  }
  error?: string
  requiresTotp?: boolean
  requiresPasskey?: boolean
}

export interface SessionResponse {
  authenticated: boolean
  user?: {
    id: string
    callsign: string
  }
  expiresAt?: string
}
