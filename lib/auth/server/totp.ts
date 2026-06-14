// TOTP implementation using Web Crypto API (no external dependencies)

const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

// Generate a random Base32 secret
export function generateTOTPSecret(length = 20): string {
  const randomBytes = new Uint8Array(length)
  crypto.getRandomValues(randomBytes)

  let secret = ""
  for (let i = 0; i < length; i++) {
    secret += BASE32_CHARS[randomBytes[i] % 32]
  }
  return secret
}

// Decode Base32 to Uint8Array
function base32Decode(encoded: string): Uint8Array<ArrayBuffer> {
  const cleaned = encoded.toUpperCase().replace(/[^A-Z2-7]/g, "")
  const output = new Uint8Array(Math.floor((cleaned.length * 5) / 8))

  let bits = 0
  let value = 0
  let index = 0

  for (const char of cleaned) {
    const charIndex = BASE32_CHARS.indexOf(char)
    if (charIndex === -1) continue

    value = (value << 5) | charIndex
    bits += 5

    if (bits >= 8) {
      output[index++] = (value >>> (bits - 8)) & 0xff
      bits -= 8
    }
  }

  return output.slice(0, index)
}

// Generate TOTP code
export async function generateTOTP(secret: string, timeStep = 30): Promise<string> {
  const counter = Math.floor(Date.now() / 1000 / timeStep)
  const counterBuffer = new ArrayBuffer(8)
  const counterView = new DataView(counterBuffer)
  counterView.setBigUint64(0, BigInt(counter), false)

  const keyData = base32Decode(secret)
  const key = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-1" }, false, ["sign"])

  const signature = await crypto.subtle.sign("HMAC", key, counterBuffer)
  const signatureArray = new Uint8Array(signature)

  const offset = signatureArray[signatureArray.length - 1] & 0x0f
  const binary =
    ((signatureArray[offset] & 0x7f) << 24) |
    ((signatureArray[offset + 1] & 0xff) << 16) |
    ((signatureArray[offset + 2] & 0xff) << 8) |
    (signatureArray[offset + 3] & 0xff)

  const otp = binary % 1000000
  return otp.toString().padStart(6, "0")
}

// Length-independent constant-time string comparison for short codes.
// Avoids leaking how many leading digits matched via early-exit timing.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

/**
 * Verify a TOTP code and return the time-step counter it matched.
 *
 * The returned `counter` lets callers enforce single-use semantics: persist
 * it per user and reject any future code whose counter is <= the last one
 * accepted, so an intercepted code can't be replayed within its validity
 * window. Returns counter -1 when the code is invalid.
 */
export async function verifyTOTPWithCounter(
  secret: string,
  token: string,
  window = 1,
  timeStep = 30,
): Promise<{ valid: boolean; counter: number }> {
  const cleanToken = token.replace(/\s/g, "")
  if (!/^\d{6}$/.test(cleanToken)) {
    return { valid: false, counter: -1 }
  }

  const currentTime = Math.floor(Date.now() / 1000 / timeStep)

  for (let i = -window; i <= window; i++) {
    const counter = currentTime + i
    const counterBuffer = new ArrayBuffer(8)
    const counterView = new DataView(counterBuffer)
    counterView.setBigUint64(0, BigInt(counter), false)

    const keyData = base32Decode(secret)
    const key = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-1" }, false, ["sign"])

    const signature = await crypto.subtle.sign("HMAC", key, counterBuffer)
    const signatureArray = new Uint8Array(signature)

    const offset = signatureArray[signatureArray.length - 1] & 0x0f
    const binary =
      ((signatureArray[offset] & 0x7f) << 24) |
      ((signatureArray[offset + 1] & 0xff) << 16) |
      ((signatureArray[offset + 2] & 0xff) << 8) |
      (signatureArray[offset + 3] & 0xff)

    const expectedOtp = (binary % 1000000).toString().padStart(6, "0")

    if (timingSafeEqual(expectedOtp, cleanToken)) {
      return { valid: true, counter }
    }
  }

  return { valid: false, counter: -1 }
}

// Verify TOTP code (checks current and adjacent windows for clock drift).
// Prefer verifyTOTPWithCounter where replay protection is needed.
export async function verifyTOTP(secret: string, token: string, window = 1, timeStep = 30): Promise<boolean> {
  return (await verifyTOTPWithCounter(secret, token, window, timeStep)).valid
}

// Generate otpauth:// URI for QR codes
export function generateTOTPUri(secret: string, accountName: string, issuer = "OOOI"): string {
  const encodedIssuer = encodeURIComponent(issuer)
  const encodedAccount = encodeURIComponent(accountName)
  return `otpauth://totp/${encodedIssuer}:${encodedAccount}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`
}
