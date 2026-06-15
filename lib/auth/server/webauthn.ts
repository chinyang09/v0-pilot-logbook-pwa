import type { PasskeyCredential, AuthenticatorTransport } from "@/lib/auth/types"

// Friendly default passkey label derived from the request's user-agent. Shared
// by every registration/add-passkey route so the naming stays consistent.
export function getDeviceNameFromUA(ua: string): string {
  if (ua.includes("iPhone")) return "iPhone"
  if (ua.includes("iPad")) return "iPad"
  if (ua.includes("Macintosh") || ua.includes("Mac OS X")) return "Mac"
  if (ua.includes("Android")) return "Android Device"
  if (ua.includes("Windows")) return "Windows PC"
  if (ua.includes("Linux")) return "Linux Device"
  return "New Device"
}

// Base64URL encoding/decoding utilities
export function base64URLEncode(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  let binary = ""
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

export function base64URLDecode(str: string): Uint8Array<ArrayBuffer> {
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
// Pass the request host header from API routes for accurate production domain detection
export function getRP(requestHost?: string) {
  // Server-side: prefer request host header, then fall back to environment variables
  if (typeof window === "undefined") {
    let hostname = "localhost"

    // Priority 1: Use the actual request host header (most accurate in production)
    if (requestHost) {
      hostname = requestHost.split(":")[0] // Remove port if present
    } else {
      // Priority 2: Use NEXT_PUBLIC_APP_URL (user-configured production URL)
      // Priority 3: Use VERCEL_PROJECT_PRODUCTION_URL (Vercel's production URL)
      // Priority 4: Use VERCEL_URL (deployment preview URL - least preferred)
      const envUrl =
        process.env.NEXT_PUBLIC_APP_URL ||
        process.env.VERCEL_PROJECT_PRODUCTION_URL ||
        process.env.VERCEL_URL ||
        ""
      hostname =
        envUrl
          .replace(/^https?:\/\//, "")
          .split(":")[0]
          .split("/")[0] || "localhost"
    }

    return {
      name: "OOOI Pilot Logbook",
      id: hostname === "localhost" ? "localhost" : hostname,
    }
  }

  // Client-side: use window.location
  const hostname = window.location.hostname
  return {
    name: "OOOI Pilot Logbook",
    id: hostname === "localhost" ? "localhost" : hostname,
  }
}

// Generate registration options for WebAuthn
export function generateRegistrationOptions(
  userId: string,
  userName: string,
  existingCredentials: (PasskeyCredential | string)[] = [], // Accepts full objects or just IDs
  requestHost?: string, // Pass request host header for production
): PublicKeyCredentialCreationOptions {
  const rp = getRP(requestHost);
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  return {
    challenge,
    rp: { name: rp.name, id: rp.id },
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
      // Username-less (discoverable) login requires a resident/discoverable
      // credential, so demand it instead of "preferred" — otherwise some
      // authenticators create a non-discoverable key and the passkey button
      // silently finds nothing. No authenticatorAttachment lock so a passkey
      // from a phone can be used on desktop via the hybrid/QR transport.
      residentKey: "required",
      requireResidentKey: true,
      userVerification: "required",
    },
    excludeCredentials: existingCredentials.map((cred) => {
      // Handle both string IDs and Passkey Objects
      const id = typeof cred === "string" ? cred : cred.id;
      return {
        id: base64URLDecode(id),
        type: "public-key" as const,
        transports: typeof cred === "string" ? undefined : cred.transports,
      };
    }),
  }
}

// Generate authentication options for WebAuthn (username-less)
export function generateAuthenticationOptions(
  allowCredentials?: PasskeyCredential[],
  requestHost?: string, // Pass request host header for production
): PublicKeyCredentialRequestOptions {
  const rp = getRP(requestHost)
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

// Authenticator-data flag bits (WebAuthn §6.1).
const FLAG_UP = 0x01 // User Present
const FLAG_UV = 0x04 // User Verified
const FLAG_BE = 0x08 // Backup Eligible (multi-device)
const FLAG_BS = 0x10 // Backup State (currently backed up)

// Derive the browser-equivalent origin from the request. Behind Vercel/any
// proxy the original scheme arrives in x-forwarded-proto, and the Host header
// already carries the port when non-default, so `${proto}://${host}` is exactly
// what the browser puts in clientDataJSON.origin.
export function getExpectedOrigin(requestHost?: string, forwardedProto?: string): string | undefined {
  if (!requestHost) return undefined
  const hostname = requestHost.split(":")[0]
  const isLocal = hostname === "localhost" || hostname === "127.0.0.1"
  const proto = (forwardedProto?.split(",")[0].trim() || (isLocal ? "http" : "https")).replace(/[^a-z]/gi, "")
  return `${proto}://${requestHost}`
}

// The security-relevant property is that the assertion was produced for OUR
// domain. The authenticator-signed rpIdHash already proves the rpId, so here we
// only require the clientDataJSON origin's hostname to equal the rpId (tolerant
// of scheme/port, which the rpIdHash check does not depend on).
function originHostMatchesRpId(origin: string, rpId: string): boolean {
  try {
    return new URL(origin).hostname === rpId
  } catch {
    return false
  }
}

// Detect the signature algorithm from the stored SPKI public key by scanning
// for the algorithm-identifier OID. Avoids storing a separate `alg` field and
// keeps every previously-registered credential verifiable.
//   id-ecPublicKey  1.2.840.10045.2.1  → 06 07 2A 86 48 CE 3D 02 01
//   rsaEncryption   1.2.840.113549.1.1.1 → 06 09 2A 86 48 86 F7 0D 01 01 01
function detectSpkiAlg(spki: Uint8Array): "ES256" | "RS256" | null {
  const EC_OID = [0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]
  const RSA_OID = [0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01]
  const contains = (needle: number[]) => {
    outer: for (let i = 0; i + needle.length <= spki.length; i++) {
      for (let j = 0; j < needle.length; j++) {
        if (spki[i + j] !== needle[j]) continue outer
      }
      return true
    }
    return false
  }
  if (contains(EC_OID)) return "ES256"
  if (contains(RSA_OID)) return "RS256"
  return null
}

export interface AuthnVerificationContext {
  expectedRpId: string
  expectedOrigin?: string
}

// Verify authentication response
//
// The browser sends the assertion as base64url strings; API routes decode them
// to byte arrays before calling this. This routine MUST be invoked on every
// passkey login — it binds the assertion to the server-issued challenge, the
// relying-party id and origin, requires user presence/verification, and
// cryptographically verifies the signature against the stored public key.
export async function verifyAuthenticationResponse(
  credential: { response: { authenticatorData: Uint8Array; clientDataJSON: Uint8Array; signature: Uint8Array } },
  expectedChallenge: Uint8Array,
  storedCredential: PasskeyCredential,
  context: AuthnVerificationContext,
): Promise<{ verified: boolean; newCounter: number }> {
  const response = credential.response

  // Get authenticator data and client data
  const authData = new Uint8Array(response.authenticatorData)
  const clientDataJSON = new Uint8Array(response.clientDataJSON)
  const signature = new Uint8Array(response.signature)

  if (authData.length < 37) return { verified: false, newCounter: 0 }

  // Verify the assertion is an authentication ceremony bound to our challenge.
  let clientData: { type?: string; challenge?: string; origin?: string }
  try {
    clientData = JSON.parse(new TextDecoder().decode(clientDataJSON))
  } catch {
    return { verified: false, newCounter: 0 }
  }
  if (clientData.type !== "webauthn.get") return { verified: false, newCounter: 0 }
  if (!clientData.challenge || !arraysEqual(base64URLDecode(clientData.challenge), expectedChallenge)) {
    return { verified: false, newCounter: 0 }
  }

  // Bind to our origin/relying-party.
  if (!clientData.origin || !originHostMatchesRpId(clientData.origin, context.expectedRpId)) {
    console.warn("[WebAuthn] Origin mismatch:", clientData.origin)
    return { verified: false, newCounter: 0 }
  }
  if (context.expectedOrigin && clientData.origin !== context.expectedOrigin) {
    // Non-fatal (scheme/port can legitimately differ from our reconstruction),
    // but worth surfacing.
    console.warn("[WebAuthn] Origin not exact:", clientData.origin, "expected", context.expectedOrigin)
  }

  // The authenticator signs rpIdHash || flags || counter; verifying rpIdHash
  // proves the assertion was scoped to our domain.
  const expectedRpIdHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(context.expectedRpId)),
  )
  if (!arraysEqual(authData.slice(0, 32), expectedRpIdHash)) {
    console.warn("[WebAuthn] rpIdHash mismatch")
    return { verified: false, newCounter: 0 }
  }

  // Require user presence and (since we always request UV "required") user
  // verification.
  const flags = authData[32]
  if ((flags & FLAG_UP) === 0) return { verified: false, newCounter: 0 }
  if ((flags & FLAG_UV) === 0) {
    console.warn("[WebAuthn] User verification flag not set")
    return { verified: false, newCounter: 0 }
  }

  // Hash the clientDataJSON and build the signed payload.
  const clientDataHash = await crypto.subtle.digest("SHA-256", clientDataJSON)
  const signedData = new Uint8Array(authData.length + 32)
  signedData.set(authData)
  signedData.set(new Uint8Array(clientDataHash), authData.length)

  const publicKeyBytes = base64URLDecode(storedCredential.publicKey)
  if (publicKeyBytes.length === 0) {
    console.error("[WebAuthn] Stored credential has no public key")
    return { verified: false, newCounter: 0 }
  }
  const alg = detectSpkiAlg(publicKeyBytes) ?? "ES256"

  try {
    let verified = false
    if (alg === "RS256") {
      const key = await crypto.subtle.importKey(
        "spki",
        publicKeyBytes,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      )
      // RSA signatures are not DER-wrapped — verify the raw signature directly.
      verified = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signedData)
    } else {
      const key = await crypto.subtle.importKey(
        "spki",
        publicKeyBytes,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      )
      const rawSignature = derToRaw(signature)
      verified = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, rawSignature, signedData)
    }

    // Extract counter from authenticator data (bytes 33-36)
    const newCounter = new DataView(authData.buffer, authData.byteOffset + 33, 4).getUint32(0, false)

    // Counter / cloned-authenticator check.
    // Many platform/synced passkeys (iCloud Keychain, Google Password Manager)
    // never implement a signature counter and always report 0. Enforcing strict
    // monotonicity in that case would reject every login after the first. Only
    // enforce it when a counter is actually in use (either side non-zero).
    if ((newCounter > 0 || storedCredential.counter > 0) && newCounter <= storedCredential.counter) {
      console.warn("Possible cloned authenticator: counter did not increase")
      return { verified: false, newCounter: 0 }
    }

    return { verified, newCounter }
  } catch (error) {
    console.error("Signature verification error:", error)
    return { verified: false, newCounter: 0 }
  }
}

// Parsed + verified attestation for a registration / add-passkey ceremony.
export interface RegistrationAttestationResult {
  verified: boolean
  error?: string
  credentialId: string
  publicKey: string
  counter: number
  deviceType: "singleDevice" | "multiDevice"
  backedUp: boolean
  transports?: AuthenticatorTransport[]
}

interface RegistrationCredentialInput {
  id: string
  rawId?: string
  response: {
    clientDataJSON: string
    attestationObject: string
    publicKey?: string
    transports?: string[]
  }
}

// Verify a registration (create) ceremony for both new-account and add-passkey
// flows. Binds the attestation to our challenge, origin and relying-party id,
// requires user presence + verification, and returns the authenticator-derived
// credential fields. The public key is taken from the browser-computed SPKI
// (`getPublicKey()`); a credential without one is rejected rather than trusted.
export async function verifyRegistrationAttestation(
  credential: RegistrationCredentialInput,
  expectedChallenge: string,
  context: AuthnVerificationContext,
): Promise<RegistrationAttestationResult> {
  const fail = (error: string): RegistrationAttestationResult => ({
    verified: false,
    error,
    credentialId: "",
    publicKey: "",
    counter: 0,
    deviceType: "singleDevice",
    backedUp: false,
  })

  let clientData: { type?: string; challenge?: string; origin?: string }
  try {
    clientData = JSON.parse(new TextDecoder().decode(base64URLDecode(credential.response.clientDataJSON)))
  } catch {
    return fail("Invalid clientDataJSON")
  }

  if (clientData.type !== "webauthn.create") return fail("Not a registration ceremony")
  if (clientData.challenge !== expectedChallenge) return fail("Challenge mismatch")
  if (!clientData.origin || !originHostMatchesRpId(clientData.origin, context.expectedRpId)) {
    return fail("Origin mismatch")
  }

  const attestation = parseAttestationObject(base64URLDecode(credential.response.attestationObject))

  // rpIdHash must match SHA-256(rpId).
  const expectedRpIdHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(context.expectedRpId)),
  )
  if (!arraysEqual(base64URLDecode(attestation.rpIdHash), expectedRpIdHash)) {
    return fail("rpIdHash mismatch")
  }
  if (!attestation.flags.up) return fail("User not present")
  if (!attestation.flags.uv) return fail("User verification required")

  // The browser-provided SPKI is the source of truth for the stored key. The
  // signature check at login fails if it does not match the private key, so a
  // forged value cannot help an attacker — but an empty one would break login.
  const publicKey = credential.response.publicKey || ""
  if (!publicKey) return fail("Missing public key")

  return {
    verified: true,
    credentialId: credential.id,
    publicKey,
    counter: attestation.counter,
    deviceType: attestation.flags.be ? "multiDevice" : "singleDevice",
    backedUp: attestation.flags.bs,
    transports: credential.response.transports as AuthenticatorTransport[] | undefined,
  }
}

// Minimal CBOR walk to locate authData inside a "none"-attestation object and
// extract rpIdHash, flags and the signature counter.
function parseAttestationObject(attestationObject: Uint8Array) {
  let offset = 0
  while (offset < attestationObject.length) {
    if (attestationObject[offset] === 0x68 && attestationObject[offset + 1] === 0x61) break // "authData" key
    offset++
  }
  while (
    offset < attestationObject.length &&
    attestationObject[offset] !== 0x58 &&
    attestationObject[offset] !== 0x59
  ) {
    offset++
  }

  let authDataLength = 0
  if (attestationObject[offset] === 0x58) {
    authDataLength = attestationObject[offset + 1]
    offset += 2
  } else if (attestationObject[offset] === 0x59) {
    authDataLength = (attestationObject[offset + 1] << 8) | attestationObject[offset + 2]
    offset += 3
  }

  const authData = attestationObject.slice(offset, offset + authDataLength)
  const rpIdHash = authData.slice(0, 32)
  const flags = authData[32]
  const signCount = new DataView(authData.buffer, authData.byteOffset + 33, 4).getUint32(0, false)

  return {
    rpIdHash: base64URLEncode(rpIdHash),
    flags: {
      up: (flags & FLAG_UP) !== 0,
      uv: (flags & FLAG_UV) !== 0,
      be: (flags & FLAG_BE) !== 0,
      bs: (flags & FLAG_BS) !== 0,
      at: (flags & 0x40) !== 0,
    },
    counter: signCount,
  }
}

// Helper to compare arrays
function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i]
  }
  return diff === 0
}

// Convert DER signature to raw format
function derToRaw(derSig: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
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
