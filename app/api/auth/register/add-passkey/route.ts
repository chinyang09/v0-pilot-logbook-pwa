import { type NextRequest, NextResponse } from "next/server"
import { getDB } from "@/lib/mongodb"
import { base64URLDecode, base64URLEncode, generateRegistrationOptions } from "@/lib/auth/server/webauthn"
import type { User, PasskeyCredential, StoredChallenge } from "@/lib/auth/types"
import { cookies } from "next/headers"

// GET: Generate options for an existing user to add a new device
export async function GET(request: NextRequest) {
  try {
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

    const options = generateRegistrationOptions(user._id!.toString(), user.identity.callsign, user.auth.passkeys)
    const challengeBase64 = base64URLEncode(options.challenge as Uint8Array)

    await db.collection<StoredChallenge>("challenges").insertOne({
      _id: challengeBase64,
      userId: user._id!.toString(),
      expiresAt: new Date(Date.now() + 60000),
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
        transports: p.transports,
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
    const { credential, challenge, name } = await request.json()
    const db = await getDB()

    console.log("[v0] Add passkey POST - challenge:", challenge)

    const storedChallenge = await db.collection<StoredChallenge>("challenges").findOne({ _id: challenge })

    console.log("[v0] Stored challenge found:", !!storedChallenge)

    if (storedChallenge) {
      await db.collection("challenges").deleteOne({ _id: challenge })
    }

    if (!storedChallenge || storedChallenge.expiresAt < new Date()) {
      return NextResponse.json({ error: "Challenge expired" }, { status: 400 })
    }

    const cookieStore = await cookies()
    const sessionId = cookieStore.get("session")?.value

    console.log("[v0] POST sessionId from cookie:", sessionId)

    const session = await db.collection("sessions").findOne({
      token: sessionId,
      expiresAt: { $gt: new Date() },
    })

    console.log("[v0] POST session lookup:", session ? { userId: session.userId } : "null")
    console.log(
      "[v0] Comparing session.userId:",
      session?.userId,
      "with storedChallenge.userId:",
      storedChallenge.userId,
    )

    if (!session || session.userId.toString() !== storedChallenge.userId.toString()) {
      console.log("[v0] Session/challenge mismatch")
      return NextResponse.json({ error: "Invalid session" }, { status: 401 })
    }

    const credentialData = await parseClientCredential(credential)
    const userAgent = request.headers.get("user-agent") || ""

    const newPasskey: PasskeyCredential = {
      id: credentialData.credentialId,
      publicKey: credentialData.publicKey,
      counter: credentialData.counter,
      deviceType: credentialData.deviceType,
      backedUp: credentialData.backedUp,
      transports: credentialData.transports,
      createdAt: Date.now(),
      name: name || getDeviceName(userAgent),
    }

    const updateResult = await db.collection("users").updateOne(
      { _id: session.userId as any },
      {
        $push: { "auth.passkeys": newPasskey } as any,
        $set: { updatedAt: Date.now() },
      },
    )

    console.log("[v0] Update by string userId matched:", updateResult.matchedCount)

    if (updateResult.matchedCount === 0) {
      return NextResponse.json({ error: "User not found for update" }, { status: 404 })
    }

    // Clear recovery flag in session
    await db.collection("sessions").updateOne({ token: sessionId }, { $unset: { recoveryLogin: "" } })

    console.log("[v0] Passkey added successfully")

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Add passkey POST error:", error)
    return NextResponse.json({ error: "Failed to add passkey" }, { status: 500 })
  }
}

async function parseClientCredential(credential: any) {
  const attestationObject = base64URLDecode(credential.response.attestationObject)
  const authData = parseAttestationObject(attestationObject)
  return {
    credentialId: credential.id,
    publicKey: credential.response.publicKey || authData.publicKey,
    counter: authData.counter,
    deviceType: authData.flags.be ? ("multiDevice" as const) : ("singleDevice" as const),
    backedUp: authData.flags.bs,
    transports: credential.response.transports,
  }
}

// Parse attestation object (CBOR)
function parseAttestationObject(attestationObject: Uint8Array) {
  let offset = 0

  while (offset < attestationObject.length) {
    if (attestationObject[offset] === 0x68 && attestationObject[offset + 1] === 0x61) {
      break
    }
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

  const up = (flags & 0x01) !== 0
  const uv = (flags & 0x04) !== 0
  const be = (flags & 0x08) !== 0
  const bs = (flags & 0x10) !== 0
  const at = (flags & 0x40) !== 0

  let publicKey = ""
  if (at && authData.length > 37) {
    const aaguid = authData.slice(37, 53)
    const credIdLength = (authData[53] << 8) | authData[54]
    const credId = authData.slice(55, 55 + credIdLength)
    const publicKeyBytes = authData.slice(55 + credIdLength)
    publicKey = base64URLEncode(publicKeyBytes)
  }

  return {
    rpIdHash: base64URLEncode(rpIdHash),
    flags: { up, uv, be, bs, at },
    counter: signCount,
    publicKey,
  }
}

function getDeviceName(ua: string): string {
  if (ua.includes("iPhone")) return "iPhone"
  if (ua.includes("iPad")) return "iPad"
  if (ua.includes("Macintosh") || ua.includes("Mac OS X")) return "Mac"
  if (ua.includes("Android")) return "Android Device"
  if (ua.includes("Windows")) return "Windows PC"
  if (ua.includes("Linux")) return "Linux Device"
  return "New Device"
}
