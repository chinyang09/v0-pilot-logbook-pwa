/**
 * User entity type definitions
 * Used for authentication and session management
 */

export type AuthenticatorTransport = "usb" | "ble" | "nfc" | "internal" | "hybrid"

/**
 * Passkey credential stored in MongoDB
 */
export interface PasskeyCredential {
  id: string // Base64URL encoded credential ID
  publicKey: string // Base64URL encoded public key
  counter: number // Signature counter
  deviceType: "singleDevice" | "multiDevice"
  backedUp: boolean
  transports?: AuthenticatorTransport[]
  createdAt: number
  name?: string // User-friendly name
}

/**
 * User document in MongoDB
 */
export interface User {
  _id: string // CUID - constant anchor
  identity: {
    callsign: string // Display name
    searchKey: string // Normalized callsign (unique index)
  }
  auth: {
    totpSecret: string // Base32 secret
    totpEnabled: boolean
    passkeys: PasskeyCredential[]
  }
  createdAt: number
  updatedAt: number
}

/**
 * Session stored in MongoDB
 */
export interface Session {
  _id?: unknown // MongoDB ObjectId
  token: string // CUID session token
  userId: string
  callsign: string
  expiresAt: Date
  lastAccessedAt: Date
  createdAt: Date
  recoveryLogin?: boolean // Flag for nudge UI
}

/**
 * Session stored in IndexedDB (client-side)
 */
export interface LocalSession {
  id: string // Always "current"
  userId: string // CUID reference
  callsign: string
  sessionToken: string // Matches 'token' in MongoDB
  expiresAt: number // Unix timestamp
  createdAt: number
}

/**
 * WebAuthn challenge for registration/authentication
 */
export interface WebAuthnChallenge {
  challenge: string
  expiresAt: number
  userId?: string
  type: "registration" | "authentication"
}

/**
 * Stored challenge in MongoDB (with TTL)
 */
export interface StoredChallenge {
  _id: string // The challenge string
  userId: string
  expiresAt: Date
  type: "registration" | "authentication"
}
