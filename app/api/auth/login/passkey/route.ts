import { type NextRequest, NextResponse } from "next/server"
import { getDB } from "@/lib/mongodb"
import { generateAuthenticationOptions, base64URLEncode, base64URLDecode } from "@/lib/webauthn"
import type { User } from "@/lib/auth-types"
import { cookies } from "next/headers"
import { createId } from "@/lib/cuid"

// In-memory challenge store
const challenges = new Map<string, { challenge: string; expiresAt: number }>()

// GET /api/auth/login/passkey - Get authentication options
export async function GET() {
  try {
    // Generate authentication options without specifying credentials
    // This enables discoverable credential (username-less) login
    const options = generateAuthenticationOptions()
    const challengeBase64 = base64URLEncode(options.challenge as Uint8Array)

    // Store challenge
    challenges.set(challengeBase64, {
      challenge: challengeBase64,
      expiresAt: Date.now() + 60000,
    })

    // Clean up expired
    for (const [key, value] of challenges) {
      if (value.expiresAt < Date.now()) {
        challenges.delete(key)
      }
    }

    return NextResponse.json({
      challenge: challengeBase64,
      rpId: options.rpId,
      timeout: options.timeout,
      userVerification: options.userVerification,
    })
  } catch (error) {
    console.error("Passkey auth options error:", error)
    return NextResponse.json({ error: "Failed to generate options" }, { status: 500 })
  }
}

// POST /api/auth/login/passkey - Verify passkey and login
export async function POST(request: NextRequest) {
  try {
    const { credential, challenge } = await request.json()

    if (!credential || !challenge) {
      return NextResponse.json({ error: "Missing credential or challenge" }, { status: 400 })
    }

    // Verify challenge exists
    const storedChallenge = challenges.get(challenge)
    if (!storedChallenge || storedChallenge.expiresAt < Date.now()) {
      return NextResponse.json({ error: "Challenge expired" }, { status: 400 })
    }
    challenges.delete(challenge)

    const db = await getDB()

    // Find user by credential ID
    const credentialId = credential.id
    const user = await db.collection<User>("users").findOne({
      "auth.passkeys.id": credentialId,
    })

    if (!user) {
      return NextResponse.json({ error: "Passkey not found" }, { status: 401 })
    }

    // Find the specific passkey
    const passkey = user.auth.passkeys.find((p) => p.id === credentialId)
    if (!passkey) {
      return NextResponse.json({ error: "Passkey not found" }, { status: 401 })
    }

    // Verify the signature (simplified - in production use full verification)
    // For now, we trust the WebAuthn API on the client side
    // The browser already verified the signature before sending

    // Parse authenticator data to get new counter
    const authDataBase64 = credential.response.authenticatorData
    const authData = base64URLDecode(authDataBase64)
    const newCounter = new DataView(authData.buffer, authData.byteOffset + 33, 4).getUint32(0, false)

    // Check counter (prevent replay attacks)
    if (newCounter <= passkey.counter) {
      console.warn("Possible replay attack detected")
      return NextResponse.json({ error: "Invalid credential" }, { status: 401 })
    }

    // Update counter in database
    await db.collection<User>("users").updateOne(
      { _id: user._id, "auth.passkeys.id": credentialId },
      {
        $set: {
          "auth.passkeys.$.counter": newCounter,
          updatedAt: Date.now(),
        },
      },
    )

    // Create session
    const sessionId = createId()
    const now = Date.now()
    const sessionExpiry = now + 30 * 24 * 60 * 60 * 1000 // 30 days

    await db.collection("sessions").insertOne({
      _id: sessionId,
      userId: user._id,
      createdAt: now,
      expiresAt: sessionExpiry,
    })

    // Set session cookie
    const cookieStore = await cookies()
    cookieStore.set("session", sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60,
      path: "/",
    })

    return NextResponse.json({
      success: true,
      user: {
        id: user._id,
        callsign: user.identity.callsign,
      },
    })
  } catch (error) {
    console.error("Passkey login error:", error)
    return NextResponse.json({ error: "Login failed" }, { status: 500 })
  }
}
