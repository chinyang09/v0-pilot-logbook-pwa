// Simple CUID2-like ID generator using Web Crypto
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz"
const ID_LENGTH = 24

export function createId(): string {
  // Start with timestamp for sortability
  const timestamp = Date.now().toString(36)

  // Generate random bytes
  const randomBytes = new Uint8Array(ID_LENGTH - timestamp.length)
  crypto.getRandomValues(randomBytes)

  let random = ""
  for (let i = 0; i < randomBytes.length; i++) {
    random += ALPHABET[randomBytes[i] % ALPHABET.length]
  }

  return timestamp + random
}

// Normalize callsign for search (lowercase, no spaces)
export function normalizeCallsign(callsign: string): string {
  return callsign.toLowerCase().replace(/\s+/g, "")
}
