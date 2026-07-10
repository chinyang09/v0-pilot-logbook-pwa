export const dynamic = "force-dynamic"
export const revalidate = 0

import { type NextRequest, NextResponse } from "next/server"
import { getDB } from "@/lib/mongodb"
import {
  generateAuthenticationOptions,
  base64URLEncode,
  base64URLDecode,
  verifyAuthenticationResponse,
  getRP,
  getExpectedOrigin,
} from "@/lib/auth/server/webauthn"
import type { User } from "@/lib/auth/types"
import { issueSession, setSessionCookie } from "@/lib/auth/server/session"
import { normalizePasskeyTransports } from "@/lib/auth/server/passkey-maintenance"

// GET /api/auth/login/passkey
export async function GET(request: Request) {
  try {
    // Get the host header for accurate RP ID in production
    const host = request.headers.get("host") || undefined
    const options = generateAuthenticationOptions(undefined, host)
    const challengeBase64 = base64URLEncode(options.challenge as Uint8Array)

    const db = await getDB()

    // ✅ Store expiresAt as a Date object
    await db.collection<{ _id: string; [key: string]: unknown }>("challenges").insertOne({
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

    // Cryptographically verify the assertion. Without this, anyone who knows a
    // (non-secret) credential ID could forge a login by sending a fresh
    // challenge and arbitrary authenticatorData. The challenge above is only
    // proof the request is recent — not proof of possession of the private key.
    const assertion = credential?.response
    if (!assertion?.authenticatorData || !assertion?.clientDataJSON || !assertion?.signature) {
      return NextResponse.json({ error: "Invalid credential" }, { status: 400 })
    }

    const host = request.headers.get("host") || undefined
    const expectedRpId = getRP(host).id
    const expectedOrigin = getExpectedOrigin(host, request.headers.get("x-forwarded-proto") || undefined)

    let verification: { verified: boolean; newCounter: number }
    try {
      verification = await verifyAuthenticationResponse(
        {
          response: {
            authenticatorData: base64URLDecode(assertion.authenticatorData),
            clientDataJSON: base64URLDecode(assertion.clientDataJSON),
            signature: base64URLDecode(assertion.signature),
          },
        },
        base64URLDecode(challenge),
        passkey,
        { expectedRpId, expectedOrigin },
      )
    } catch (err) {
      console.error("Passkey verification error:", err)
      return NextResponse.json({ error: "Verification failed" }, { status: 401 })
    }

    if (!verification.verified) {
      return NextResponse.json({ error: "Verification failed" }, { status: 401 })
    }

    // Persist the highest counter seen so a real cloned-authenticator rollback
    // is still caught on the next login.
    const finalCounter = Math.max(verification.newCounter, passkey.counter)

    await db.collection<User>("users").updateOne(
      { _id: user._id, "auth.passkeys.id": credentialId },
      {
        $set: {
          "auth.passkeys.$.counter": finalCounter,
          updatedAt: Date.now(), // Timestamps in User doc are fine as Numbers, but Dates are better for sessions
        },
      },
    )

    // Self-heal any malformed stored passkey transports (runs after the counter
    // write, reads fresh, so it never reverts the counter). Fire-and-forget.
    void normalizePasskeyTransports(db, user._id.toString())

    const { token: sessionId, expiresAt: sessionExpiry } = await issueSession(db, {
      userId: user._id.toString(),
      callsign: user.identity.callsign,
      deviceId: deviceId || "unknown_device",
      userAgent: request.headers.get("user-agent") || undefined,
    })
    await setSessionCookie(sessionId)

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
