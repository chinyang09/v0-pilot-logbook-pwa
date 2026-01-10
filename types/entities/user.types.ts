/**
 * User-related type definitions
 */

export type AuthenticatorTransport = "usb" | "ble" | "nfc" | "internal" | "hybrid"

/**
 * Passkey credential stored in MongoDB
 */
export interface PasskeyCredential {
  id: string
  publicKey: string
  counter: number
  deviceType: "singleDevice" | "multiDevice"
  backedUp: boolean
  transports?: AuthenticatorTransport[]
  createdAt: number
  name?: string
}

/**
 * User schema for MongoDB
 */
export interface User {
  _id: string
  identity: {
    callsign: string
    searchKey: string
  }
  auth: {
    totpSecret: string
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
  _id?: any
  token: string
  userId: string
  callsign: string
  expiresAt: Date
  lastAccessedAt: Date
  createdAt: Date
  recoveryLogin?: boolean
}

/**
 * User session stored in IndexedDB for silent persistence
 */
export interface UserSession {
  id: string
  userId: string
  callsign: string
  sessionToken: string
  expiresAt: number
  createdAt: number
}

/**
 * Local session type for client-side use
 */
export interface LocalSession {
  userId: string
  callsign: string
  sessionToken: string
  expiresAt: number
  createdAt: number
}

/**
 * WebAuthn challenge for API responses
 */
export interface WebAuthnChallenge {
  challenge: string
  expiresAt: number
  userId?: string
  type: "registration" | "authentication"
}

/**
 * Stored challenge in MongoDB with TTL
 */
export interface StoredChallenge {
  _id: string
  userId: string
  expiresAt: Date
  type: "registration" | "authentication"
}
