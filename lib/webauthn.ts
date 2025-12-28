import type { PasskeyCredential, AuthenticatorTransport } from "./auth-types"

// Base64URL encoding/decoding utilities
export function base64URLEncode(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  let binary = ""
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

export function base64URLDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/")
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

// Generate a random challenge
export function generateChallenge(): string {
  const buffer = new Uint8Array(32)
  crypto.getRandomValues(buffer)
  return base64URLEncode(buffer)
}

// RP (Relying Party) configuration
export function getRP() {
  // Server-side: use environment variable
  if (typeof window === "undefined") {
    const envUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || ""
    const hostname =
      envUrl
        .replace(/^https?:\/\//, "")
        .split(":")[0]
        .split("/")[0] || "localhost"
    return {
      name: "SkyLog Pilot Logbook",
      id: hostname === "localhost" ? "localhost" : hostname,
    }
  }

  // Client-side: use window.location
  const hostname = window.location.hostname
  return {
    name: "SkyLog Pilot Logbook",
    id: hostname === "localhost" ? "localhost" : hostname,
  }
}

// Generate registration options for WebAuthn
export function generateRegistrationOptions(
  userId: string,
  userName: string,
  existingCredentials: PasskeyCredential[] = [],
): PublicKeyCredentialCreationOptions {
  const rp = getRP()
  const challenge = crypto.getRandomValues(new Uint8Array(32))

  return {
    challenge,
    rp: {
      name: rp.name,
      id: rp.id,
    },
    user: {
      id: new TextEncoder().encode(userId),
      name: userName,
      displayName: userName,
    },
    pubKeyCredParams: [
      { alg: -7, type: "public-key" }, // ES256
      { alg: -257, type: "public-key" }, // RS256
    ],
    timeout: 60000,
    attestation: "none",
    authenticatorSelection: {
      residentKey: "required", // Discoverable credentials for username-less login
      userVerification: "required", // Biometric/PIN required
      authenticatorAttachment: "platform", // Prefer built-in authenticators
    },
    excludeCredentials: existingCredentials.map((cred) => ({
      id: base64URLDecode(cred.id),
      type: "public-key" as const,
      transports: cred.transports,
    })),
  }
}

// Generate authentication options for WebAuthn (username-less)
export function generateAuthenticationOptions(
  allowCredentials?: PasskeyCredential[],
): PublicKeyCredentialRequestOptions {
  const rp = getRP()
  const challenge = crypto.getRandomValues(new Uint8Array(32))

  return {
    challenge,
    rpId: rp.id,
    timeout: 60000,
    userVerification: "required",
    // If no credentials specified, allow discoverable credentials (username-less)
    allowCredentials: allowCredentials?.map((cred) => ({
      id: base64URLDecode(cred.id),
      type: "public-key" as const,
      transports: cred.transports,
    })),
  }
}

// Parse registration response and extract credential data
export async function parseRegistrationResponse(credential: PublicKeyCredential): Promise<{
  credentialId: string
  publicKey: string
  counter: number
  deviceType: "singleDevice" | "multiDevice"
  backedUp: boolean
  transports?: AuthenticatorTransport[]
}> {
  const response = credential.response as AuthenticatorAttestationResponse

  const credentialId = base64URLEncode(credential.rawId)
  const publicKey = base64URLEncode(response.getPublicKey()!)

  // Get authenticator data
  const authData = new Uint8Array(response.getAuthenticatorData())

  // Flags are at byte 32
  const flags = authData[32]
  const backedUp = (flags & 0x10) !== 0 // BS flag
  const deviceType = (flags & 0x08) !== 0 ? "multiDevice" : "singleDevice" // BE flag

  // Counter is at bytes 33-36 (big endian)
  const counter = new DataView(authData.buffer, 33, 4).getUint32(0, false)

  // Get transports if available
  const transports = response.getTransports?.() as AuthenticatorTransport[] | undefined

  return {
    credentialId,
    publicKey,
    counter,
    deviceType,
    backedUp,
    transports,
  }
}

// Verify authentication response
export async function verifyAuthenticationResponse(
  credential: PublicKeyCredential,
  expectedChallenge: Uint8Array,
  storedCredential: PasskeyCredential,
): Promise<{ verified: boolean; newCounter: number }> {
  const response = credential.response as AuthenticatorAssertionResponse

  // Get authenticator data and client data
  const authData = new Uint8Array(response.authenticatorData)
  const clientDataJSON = new Uint8Array(response.clientDataJSON)
  const signature = new Uint8Array(response.signature)

  // Verify the challenge in clientDataJSON
  const clientData = JSON.parse(new TextDecoder().decode(clientDataJSON))
  const receivedChallenge = base64URLDecode(clientData.challenge)

  if (!arraysEqual(receivedChallenge, expectedChallenge)) {
    return { verified: false, newCounter: 0 }
  }

  // Verify signature
  const publicKeyBytes = base64URLDecode(storedCredential.publicKey)

  // Hash the clientDataJSON
  const clientDataHash = await crypto.subtle.digest("SHA-256", clientDataJSON)

  // Concatenate authenticatorData + hash(clientDataJSON)
  const signedData = new Uint8Array(authData.length + 32)
  signedData.set(authData)
  signedData.set(new Uint8Array(clientDataHash), authData.length)

  // Import the public key and verify
  try {
    const key = await crypto.subtle.importKey("spki", publicKeyBytes, { name: "ECDSA", namedCurve: "P-256" }, false, [
      "verify",
    ])

    // Convert DER signature to raw format for WebCrypto
    const rawSignature = derToRaw(signature)

    const verified = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, rawSignature, signedData)

    // Extract counter from authenticator data (bytes 33-36)
    const newCounter = new DataView(authData.buffer, authData.byteOffset + 33, 4).getUint32(0, false)

    // Counter should be greater than stored counter
    if (newCounter <= storedCredential.counter) {
      console.warn("Possible replay attack: counter not incremented")
      return { verified: false, newCounter: 0 }
    }

    return { verified, newCounter }
  } catch (error) {
    console.error("Signature verification error:", error)
    return { verified: false, newCounter: 0 }
  }
}

// Helper to compare arrays
function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

// Convert DER signature to raw format
function derToRaw(derSig: Uint8Array): Uint8Array {
  // DER format: 0x30 [total-length] 0x02 [r-length] [r] 0x02 [s-length] [s]
  if (derSig[0] !== 0x30) {
    // Already in raw format or invalid
    return derSig
  }

  let offset = 2 // Skip 0x30 and total length

  // Read R
  if (derSig[offset] !== 0x02) throw new Error("Invalid DER signature")
  offset++
  const rLength = derSig[offset]
  offset++
  let r = derSig.slice(offset, offset + rLength)
  offset += rLength

  // Read S
  if (derSig[offset] !== 0x02) throw new Error("Invalid DER signature")
  offset++
  const sLength = derSig[offset]
  offset++
  let s = derSig.slice(offset, offset + sLength)

  // Remove leading zeros and pad to 32 bytes
  while (r.length > 32 && r[0] === 0) r = r.slice(1)
  while (s.length > 32 && s[0] === 0) s = s.slice(1)

  const rawSig = new Uint8Array(64)
  rawSig.set(r, 32 - r.length)
  rawSig.set(s, 64 - s.length)

  return rawSig
}
