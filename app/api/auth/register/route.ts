import { type NextRequest, NextResponse } from "next/server"
import type { User, WebAuthnChallenge } from "@/lib/auth-types"

// In-memory challenge store (use Redis in production)
const challenges = new Map<string, WebAuthnChallenge>()

// POST /api/auth/register - Start registration
export async function POST(request: NextRequest) {
  try {
    const { getDB } = await import("@/lib/mongodb")
    const { createId, normalizeCallsign } = await import("@/lib/cuid")
    const { generateTOTPSecret, generateTOTPUri } = await import("@/lib/totp")
    const { generateRegistrationOptions, base64URLEncode } = await import("@/lib/webauthn")

    const { callsign } = await request.json()

    if (!callsign || typeof callsign !== "string" || callsign.trim().length < 2) {
      return NextResponse.json({ error: "Callsign must be at least 2 characters" }, { status: 400 })
    }

    const normalizedCallsign = normalizeCallsign(callsign.trim())
    const db = await getDB()

    // Check if callsign is already taken
    const existingUser = await db.collection<User>("users").findOne({
      "identity.searchKey": normalizedCallsign,
    })

    if (existingUser) {
      return NextResponse.json({ error: "This callsign is already taken" }, { status: 409 })
    }

    // Generate new user ID and TOTP secret
    const userId = createId()
    const totpSecret = generateTOTPSecret()
    const totpUri = generateTOTPUri(totpSecret, callsign.trim())

    // Generate WebAuthn registration options
    const registrationOptions = generateRegistrationOptions(userId, callsign.trim(), [])

    // Store the challenge temporarily
    const challengeBase64 = base64URLEncode(registrationOptions.challenge as Uint8Array)
    challenges.set(challengeBase64, {
      challenge: challengeBase64,
      expiresAt: Date.now() + 60000, // 1 minute
      userId,
      type: "registration",
    })

    // Clean up expired challenges
    for (const [key, value] of challenges) {
      if (value.expiresAt < Date.now()) {
        challenges.delete(key)
      }
    }

    return NextResponse.json({
      userId,
      callsign: callsign.trim(),
      totpSecret,
      totpUri,
      registrationOptions: {
        ...registrationOptions,
        challenge: challengeBase64,
        user: {
          ...registrationOptions.user,
          id: base64URLEncode(registrationOptions.user.id as Uint8Array),
        },
        excludeCredentials: [],
      },
    })
  } catch (error) {
    console.error("Registration start error:", error)
    return NextResponse.json({ error: "Registration failed" }, { status: 500 })
  }
}

// GET /api/auth/register/challenge - Get stored challenge
export async function GET(request: NextRequest) {
  const challengeId = request.nextUrl.searchParams.get("challenge")

  if (!challengeId) {
    return NextResponse.json({ error: "Challenge required" }, { status: 400 })
  }

  const storedChallenge = challenges.get(challengeId)

  if (!storedChallenge || storedChallenge.expiresAt < Date.now()) {
    return NextResponse.json({ error: "Challenge expired or not found" }, { status: 404 })
  }

  return NextResponse.json({ valid: true, userId: storedChallenge.userId })
}
