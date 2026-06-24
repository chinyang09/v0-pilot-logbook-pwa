import { type NextRequest, NextResponse } from "next/server"
import { getDB } from "@/lib/mongodb"
import { getRP, getExpectedOrigin, verifyRegistrationAttestation, getDeviceNameFromUA } from "@/lib/auth/server/webauthn"
import type { User, PasskeyCredential } from "@/lib/auth/types"
import { issueSession, setSessionCookie } from "@/lib/auth/server/session"

// POST /api/auth/register/complete - Complete passkey registration
export async function POST(request: NextRequest) {
  try {
    const { credential, challenge } = await request.json()

    if (!credential || !challenge) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const db = await getDB()

    // Consume the server-issued registration challenge. This proves the request
    // belongs to a ceremony we actually started and lets us trust the
    // server-authored userId/callsign/totpSecret instead of whatever the client
    // posts (which previously allowed forging accounts with a chosen userId and
    // an unverified challenge).
    const stored = await db.collection("challenges").findOneAndDelete({
      _id: challenge,
      type: "registration",
      expiresAt: { $gt: new Date() },
    })
    const raw = stored as unknown as (Record<string, unknown> & { value?: Record<string, unknown> }) | null
    const challengeDoc: Record<string, unknown> | null = raw ? raw.value ?? raw : null
    if (!challengeDoc) {
      return NextResponse.json({ error: "Challenge expired or invalid" }, { status: 400 })
    }

    // Cryptographically bind the attestation to our challenge, origin and
    // relying-party id, and require user presence + verification.
    const host = request.headers.get("host") || undefined
    const attestation = await verifyRegistrationAttestation(credential, challenge, {
      expectedRpId: getRP(host).id,
      expectedOrigin: getExpectedOrigin(host, request.headers.get("x-forwarded-proto") || undefined),
    })
    if (!attestation.verified) {
      return NextResponse.json({ error: attestation.error || "Invalid credential" }, { status: 400 })
    }

    const userId = challengeDoc.userId as string | undefined
    const totpSecret = challengeDoc.totpSecret as string | undefined
    const callsign = challengeDoc.callsign as string | undefined
    if (!userId || !totpSecret || !callsign) {
      return NextResponse.json({ error: "Challenge missing registration context" }, { status: 400 })
    }
    const searchKey =
      (challengeDoc.searchKey as string | undefined) || callsign.toLowerCase().replace(/\s+/g, "")

    // Guard against the callsign being claimed between begin and complete.
    const existing = await db.collection<User>("users").findOne({ "identity.searchKey": searchKey })
    if (existing) {
      return NextResponse.json({ error: "This callsign is already taken" }, { status: 409 })
    }

    const userAgent = request.headers.get("user-agent") || "";

    const passkeyCredential: PasskeyCredential = {
      id: attestation.credentialId,
      publicKey: attestation.publicKey,
      counter: attestation.counter,
      deviceType: attestation.deviceType,
      backedUp: attestation.backedUp,
      transports: attestation.transports,
      createdAt: Date.now(),
      name: getDeviceNameFromUA(userAgent),
    }

    const nowTimestamp = Date.now()
    const user: User = {
      _id: userId,
      identity: {
        callsign,
        searchKey,
      },
      auth: {
        totpSecret,
        totpEnabled: true,
        passkeys: [passkeyCredential],
      },
      createdAt: nowTimestamp,
      updatedAt: nowTimestamp,
    }

    // Insert user into database. The unique index on identity.searchKey is the
    // authoritative guard against a callsign claimed concurrently between the
    // begin and complete steps — translate its duplicate-key error into a 409.
    try {
      await db.collection<User>("users").insertOne(user)
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        return NextResponse.json({ error: "This callsign is already taken" }, { status: 409 })
      }
      throw err
    }

    const { token: sessionId, expiresAt: sessionExpiry } = await issueSession(db, {
      userId,
      callsign: user.identity.callsign,
      userAgent: request.headers.get("user-agent") || undefined,
    })
    await setSessionCookie(sessionId)

    return NextResponse.json({
      success: true,
      user: {
        id: userId,
        callsign: user.identity.callsign,
      },
      // Include session info for frontend sync
      session: {
        token: sessionId,
        expiresAt: sessionExpiry.getTime()
      }
    })
  } catch (error) {
    console.error("Registration complete error:", error)
    return NextResponse.json({ error: "Registration failed" }, { status: 500 })
  }
}
