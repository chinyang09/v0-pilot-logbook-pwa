// User schema for MongoDB
export interface User {
  _id: string; // CUID - the constant anchor
  identity: {
    callsign: string; // User-chosen display name (e.g., "Maverick")
    searchKey: string; // Normalized callsign (lowercase, no spaces) - unique index
  };
  auth: {
    totpSecret: string; // Base32 secret for Authenticator apps
    totpEnabled: boolean; // Whether TOTP is set up
    passkeys: PasskeyCredential[]; // Array of registered passkeys
  };
  createdAt: number;
  updatedAt: number;
}

// Passkey credential stored in MongoDB
export interface PasskeyCredential {
  id: string; // Base64URL encoded credential ID
  publicKey: string; // Base64URL encoded public key
  counter: number; // Signature counter for replay attack prevention
  deviceType: "singleDevice" | "multiDevice";
  backedUp: boolean;
  transports?: AuthenticatorTransport[];
  createdAt: number; // Keep as number for easy client-side sorting
  name?: string; // User-friendly name (e.g., "iPhone", "MacBook")
}


export interface Session {
  _id?: any; // MongoDB ObjectId
  token: string; // The actual CUID session string
  userId: string;
  callsign: string;
  expiresAt: Date; 
  lastAccessedAt: Date; 
  createdAt: Date;
  recoveryLogin?: boolean; // Flag for "Nudge" UI
}

// Session stored in IndexedDB for silent persistence
// ✅ Keep as number/string for compatibility with Dexie/IndexedDB
export interface LocalSession {
  userId: string; // CUID reference
  callsign: string;
  sessionToken: string; // Matches 'token' in MongoDB
  expiresAt: number; // Unix timestamp
  createdAt: number;
}

// WebAuthn types
export type AuthenticatorTransport =
  | "usb"
  | "ble"
  | "nfc"
  | "internal"
  | "hybrid";

/**
 * Use BSON Date for automatic TTL indexing
 */
export interface StoredChallenge {
  _id: string; // The challenge string (base64url)
  userId: string;
  expiresAt: Date; // Date for TTL cleanup
  type: "registration" | "authentication";
}

// Legacy/Ceremony type for API responses
export interface WebAuthnChallenge {
  challenge: string;
  expiresAt: number; // Unix timestamp for frontend countdowns
  userId?: string;
  type: "registration" | "authentication";
}
