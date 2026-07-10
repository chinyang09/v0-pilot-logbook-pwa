export const dynamic = "force-dynamic"

import { type NextRequest, NextResponse } from "next/server"
import { getDB } from "@/lib/mongodb"
import {
  base64URLEncode,
  generateRegistrationOptions,
  getRP,
  getExpectedOrigin,
  verifyRegistrationAttestation,
  getDeviceNameFromUA,
} from "@/lib/auth/server/webauthn"
import type { User, PasskeyCredential, StoredChallenge } from "@/lib/auth/types"
import { normalizePasskeyTransports } from "@/lib/auth/server/passkey-maintenance"
import { cookies } from "next/headers"

// GET: Generate options for an existing user to add a new device
export async function GET(request: NextRequest) {
  try {
    // Get the host header for accurate RP ID in production
    const host = request.headers.get("host") || undefined
    const cookieStore = await cookies()
    const sessionId = cookieStore.get("session")?.value
    console.log("[v0] Add passkey GET - sessionId from cookie:", sessionId)

    if (!sessionId) {
      console.log("[v0] No session cookie found")
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const db = await getDB()

    const session = await db.collection("sessions").findOne({
      token: sessionId,
      expiresAt: { $gt: new Date() },
    })

    console.log("[v0] Session lookup result:", session ? { userId: session.userId, token: session.token } : "null")

    if (!session) {
      return NextResponse.json({ error: "Session expired" }, { status: 401 })
    }

    const user = await db.collection<User>("users").findOne({
      _id: session.userId as any,
    })

    console.log("[v0] User lookup with session.userId:", session.userId, "- Found:", !!user)

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const options = generateRegistrationOptions(user._id!.toString(), user.identity.callsign, user.auth.passkeys, host)
    const challengeBase64 = base64URLEncode(options.challenge as Uint8Array)

    await db.collection<StoredChallenge>("challenges").insertOne({
      _id: challengeBase64,
      userId: user._id!.toString(),
      expiresAt: new Date(Date.now() + 60000),
      type: "add-passkey",
    } as any)

    return NextResponse.json({
      challenge: challengeBase64,
      rp: options.rp,
      user: {
        id: base64URLEncode(options.user.id as Uint8Array),
        name: options.user.name,
        displayName: options.user.displayName,
      },
      pubKeyCredParams: options.pubKeyCredParams,
      timeout: options.timeout,
      attestation: options.attestation,
      authenticatorSelection: options.authenticatorSelection,
      excludeCredentials: user.auth.passkeys.map((p) => ({
        id: p.id,
        type: "public-key",
        // Only emit transports when it's a valid non-empty string array.
        // Older/synced passkeys can carry a null/garbage value, which makes the
        // browser's credentials.create() reject with "value is not a sequence".
        ...(Array.isArray(p.transports) && p.transports.every((t) => typeof t === "string")
          ? { transports: p.transports }
          : {}),
      })),
    })
  } catch (error) {
    console.error("[v0] Passkey add options error:", error)
    return NextResponse.json({ error: "Failed to generate options" }, { status: 500 })
  }
}

// POST: Verify and PUSH the new passkey to the user array
export async function POST(request: NextRequest) {
  try {
    const { credential, challenge, name, deviceId } = await request.json()
    const db = await getDB()

    // Single-use challenge: consume it atomically and confirm it was issued for
    // an add-passkey ceremony before doing anything else.
    const storedChallenge = (await db
      .collection<StoredChallenge>("challenges")
      .findOneAndDelete({ _id: challenge })) as unknown as StoredChallenge | null

    if (!storedChallenge || storedChallenge.expiresAt < new Date()) {
      return NextResponse.json({ error: "Challenge expired" }, { status: 400 })
    }
    if (storedChallenge.type && storedChallenge.type !== "add-passkey") {
      return NextResponse.json({ error: "Invalid challenge" }, { status: 400 })
    }

    const cookieStore = await cookies()
    const sessionId = cookieStore.get("session")?.value

    const session = await db.collection("sessions").findOne({
      token: sessionId,
      expiresAt: { $gt: new Date() },
    })

    if (!session || session.userId.toString() !== storedChallenge.userId.toString()) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 })
    }

    // Cryptographically bind the attestation to the issued challenge, origin and
    // relying-party id, and require user presence + verification. Without this an
    // authenticated user could attach a credential that was never produced by
    // this ceremony (e.g. a replayed clientDataJSON).
    const host = request.headers.get("host") || undefined
    const attestation = await verifyRegistrationAttestation(credential, challenge, {
      expectedRpId: getRP(host).id,
      expectedOrigin: getExpectedOrigin(host, request.headers.get("x-forwarded-proto") || undefined),
    })
    if (!attestation.verified) {
      return NextResponse.json({ error: attestation.error || "Invalid credential" }, { status: 400 })
    }

    const userAgent = request.headers.get("user-agent") || ""

    const newPasskey: PasskeyCredential = {
      id: attestation.credentialId,
      publicKey: attestation.publicKey,
      counter: attestation.counter,
      deviceType: attestation.deviceType,
      backedUp: attestation.backedUp,
      transports: attestation.transports,
      createdAt: Date.now(),
      name: name || getDeviceNameFromUA(userAgent),
      ...(typeof deviceId === "string" && deviceId ? { deviceId } : {}),
    }

    // Idempotent add: never push a duplicate credential id (e.g. user re-runs the
    // ceremony with an authenticator that already holds a key for this account).
    const updateResult = await db.collection("users").updateOne(
      { _id: session.userId as any, "auth.passkeys.id": { $ne: attestation.credentialId } },
      {
        $push: { "auth.passkeys": newPasskey } as any,
        $set: { updatedAt: Date.now() },
      },
    )

    if (updateResult.matchedCount === 0) {
      // Either the user is gone or the credential already exists — confirm which.
      const exists = await db
        .collection("users")
        .findOne({ _id: session.userId as any, "auth.passkeys.id": attestation.credentialId })
      if (exists) return NextResponse.json({ success: true, alreadyRegistered: true })
      return NextResponse.json({ error: "User not found for update" }, { status: 404 })
    }

    // Clear recovery flag in session
    await db.collection("sessions").updateOne({ token: sessionId }, { $unset: { recoveryLogin: "" } })

    // Self-heal any pre-existing malformed passkey transports. Fire-and-forget.
    void normalizePasskeyTransports(db, session.userId.toString())

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Add passkey POST error:", error)
    return NextResponse.json({ error: "Failed to add passkey" }, { status: 500 })
  }
}
