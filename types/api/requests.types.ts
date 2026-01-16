/**
 * API request types
 */

import type { FlightLog } from "../entities/flight.types"
import type { Aircraft } from "../entities/aircraft.types"
import type { Personnel } from "../entities/crew.types"
import type { SyncOperationType } from "../sync/sync.types"

export interface SyncPushRequest {
  collection: "flights" | "aircraft" | "personnel"
  operations: Array<{
    type: SyncOperationType
    data: FlightLog | Aircraft | Personnel | { id: string;}
  }>
}

export interface SyncPullRequest {
  collection: "flights" | "aircraft" | "personnel"
  since?: number // Last sync timestamp
}

export interface AuthLoginRequest {
  callsign: string
  totp?: string
}

export interface AuthRegisterRequest {
  callsign: string
}

export interface PasskeyAddRequest {
  credential: any // WebAuthn credential
  name?: string
}
