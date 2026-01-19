export const dynamic = "force-dynamic"
export const revalidate = 0

import { type NextRequest, NextResponse } from "next/server"
import { getDB } from "@/lib/mongodb"
import { generateAuthenticationOptions, base64URLEncode, base64URLDecode } from "@/lib/auth/server/webauthn"
import type { User } from "@/lib/auth/types"
import { cookies } from "next/headers"
import { createId } from "@/lib/auth/shared/cuid"

// GET /api/auth/login/passkey
export async function GET(request: Request) {
  try {
    // Get the host header for accurate RP ID in production
    const host = request.headers.get("host") || undefined
    const options = generateAuthenticationOptions(undefined, host)
    const challengeBase64 = base64URLEncode(options.challenge as Uint8Array)

    const db = await getDB()

    // ✅ Store expiresAt as a Date object
    await db.collection("challenges").insertOne({
      _id: challengeBase64,
      challenge: challengeBase64,
      expiresAt: new Date(Date.now() + 60000),
    })

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

// POST /api/auth/login/passkey
export async function POST(request: NextRequest) {
  try {
    const { credential, challenge, deviceId } = await request.json()
    const db = await getDB()

    // ✅ Find and delete using Date object comparison
    const storedChallenge = await db.collection("challenges").findOneAndDelete({
      _id: challenge,
      expiresAt: { $gt: new Date() },
    })

    if (!storedChallenge) {
      return NextResponse.json({ error: "Challenge expired or invalid" }, { status: 400 })
    }

    const credentialId = credential.id
    const user = await db.collection<User>("users").findOne({
      "auth.passkeys.id": credentialId,
    })

    if (!user) {
      return NextResponse.json({ error: "Passkey not found" }, { status: 401 })
    }

    const passkey = user.auth.passkeys.find((p) => p.id === credentialId)
    if (!passkey) return NextResponse.json({ error: "Passkey not found" }, { status: 401 })

    const authData = base64URLDecode(credential.response.authenticatorData)
    const newCounter = new DataView(authData.buffer, authData.byteOffset + 33, 4).getUint32(0, false)

    const finalCounter = Math.max(newCounter, passkey.counter)

    await db.collection<User>("users").updateOne(
      { _id: user._id, "auth.passkeys.id": credentialId },
      {
        $set: {
          "auth.passkeys.$.counter": finalCounter,
          updatedAt: Date.now(), // Timestamps in User doc are fine as Numbers, but Dates are better for sessions
        },
      },
    )

    const sessionId = createId()
    const now = new Date()
    const sessionExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    const userIdString = user._id.toString()

    await db.collection("sessions").updateOne(
      {
        userId: userIdString,
        deviceId: deviceId || "unknown_device",
      },
      {
        $set: {
          token: sessionId, // token field for session lookup
          userId: userIdString,
          callsign: user.identity.callsign,
          expiresAt: sessionExpiry, 
          lastAccessedAt: now,
          updatedAt: now,
        },
      },
      { upsert: true },
    )

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
      user: { id: user._id, callsign: user.identity.callsign },
      session: {
        token: sessionId,
        expiresAt: sessionExpiry.getTime(), // Send as number (timestamp) to frontend
      },
    })
  } catch (error) {
    console.error("Passkey login error:", error)
    return NextResponse.json({ error: "Login failed" }, { status: 500 })
  }
}
