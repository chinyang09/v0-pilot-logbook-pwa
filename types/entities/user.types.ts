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
  /**
   * @deprecated NEVER persisted. `saveUserSession` strips it, and reading it
   * back always yields undefined.
   *
   * The session secret lives in the HttpOnly `session` cookie, which JavaScript
   * cannot read — that is the point of it being HttpOnly. Keeping a copy here
   * so it could be attached as an `Authorization: Bearer` header handed the
   * same 30-day credential to any XSS on the page, in a store that survives
   * restarts, which defeated the cookie entirely. Requests are same-origin, so
   * the browser attaches the cookie on its own and nothing needs the token.
   *
   * The field remains on the type only so a record written by an older build
   * still parses. Do not reintroduce a writer.
   */
  sessionToken?: string
  expiresAt: number
  createdAt: number
}

/**
 * Local session type for client-side use
 */
export interface LocalSession {
  userId: string
  callsign: string
  /**
   * @deprecated Never populated. The session secret lives only in the HttpOnly
   * `session` cookie — see `UserSession.sessionToken` / `saveUserSession`.
   */
  sessionToken?: string
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
