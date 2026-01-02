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
  createdAt: number;
  name?: string; // User-friendly name (e.g., "iPhone", "MacBook")
}

// Session stored in IndexedDB for silent persistence
export interface LocalSession {
  userId: string; // CUID reference
  callsign: string;
  expiresAt: number;
  createdAt: number;
}

// WebAuthn types
export type AuthenticatorTransport =
  | "usb"
  | "ble"
  | "nfc"
  | "internal"
  | "hybrid";

// Challenge stored temporarily during WebAuthn ceremonies
export interface WebAuthnChallenge {
  challenge: string;
  expiresAt: number;
  userId?: string; // For registration, the user ID being registered
  type: "registration" | "authentication";
}

// To replace WebAuthnChallenge in future once stable
export interface StoredChallenge {
  _id: string; // The challenge string (base64url)
  userId: string;
  expiresAt: number;
}
