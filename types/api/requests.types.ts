/**
 * API request type definitions
 */

import type { SyncPushPayload } from "../infrastructure/sync.types"

/**
 * Sync push request
 */
export type SyncPushRequest = SyncPushPayload

/**
 * Sync pull request params
 */
export interface SyncPullParams {
  since?: number // Unix timestamp
  collection: "flights" | "aircraft" | "crew"
}

/**
 * Auth register request
 */
export interface AuthRegisterRequest {
  callsign: string
  totpSecret: string
  totpCode: string
  credential: {
    id: string
    rawId: string
    response: {
      clientDataJSON: string
      attestationObject: string
    }
    type: "public-key"
  }
}

/**
 * Auth login TOTP request
 */
export interface AuthLoginTotpRequest {
  callsign: string
  code: string
}

/**
 * Add passkey request
 */
export interface AddPasskeyRequest {
  credential: {
    id: string
    rawId: string
    response: {
      clientDataJSON: string
      attestationObject: string
    }
    type: "public-key"
  }
  name?: string
}
