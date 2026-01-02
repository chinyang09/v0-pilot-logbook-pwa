import { type NextRequest, NextResponse } from "next/server"
import { getDB } from "@/lib/mongodb"
import { base64URLDecode, base64URLEncode, generateRegistrationOptions } from "@/lib/webauthn"
import type { User, PasskeyCredential, StoredChallenge } from "@/lib/auth-types"
import { cookies } from "next/headers"

// GET: Generate options for an existing user to add a new device
export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const sessionId = cookieStore.get("session")?.value
    if (!sessionId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const db = await getDB()

    // ✅ FIX 1: Use 'token' field and compare against new Date()
    const session = await db.collection("sessions").findOne({
      token: sessionId,
      expiresAt: { $gt: new Date() },
    })

    if (!session) {
      return NextResponse.json({ error: "Session expired" }, { status: 401 })
    }

    const user = await db.collection<User>("users").findOne({ _id: session.userId })
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 })

    const options = generateRegistrationOptions(user._id.toString(), user.identity.callsign, user.auth.passkeys)
    const challengeBase64 = base64URLEncode(options.challenge as Uint8Array)

    // ✅ FIX 2: Save challenge expiresAt as a Date object
    await db.collection<StoredChallenge>("challenges").insertOne({
      _id: challengeBase64,
      userId: user._id,
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
    console.error("Passkey add options error:", error)
    return NextResponse.json({ error: "Failed to generate options" }, { status: 500 })
  }
}

// POST: Verify and PUSH the new passkey to the user array
export async function POST(request: NextRequest) {
  try {
    const { credential, challenge, name } = await request.json()
    const db = await getDB()

    const storedChallenge = await db.collection<StoredChallenge>("challenges").findOne({ _id: challenge })

    if (storedChallenge) {
      await db.collection("challenges").deleteOne({ _id: challenge })
    }

    if (!storedChallenge || storedChallenge.expiresAt < new Date()) {
      return NextResponse.json({ error: "Challenge expired" }, { status: 400 })
    }

    const cookieStore = await cookies()
    const sessionId = cookieStore.get("session")?.value

    // ✅ FIX 3: Use 'token' field and compare against new Date()
    const session = await db.collection("sessions").findOne({
      token: sessionId,
      expiresAt: { $gt: new Date() },
    })

    if (!session || session.userId !== storedChallenge.userId) {
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
      createdAt: Date.now(), // Internal metadata can remain as Number
      name: name || getDeviceName(userAgent),
    }

    // ✅ FIX 4: ATOMIC PUSH to the array
    await db.collection("users").updateOne(
      { _id: session.userId },
      {
        $push: { "auth.passkeys": newPasskey },
        $set: { updatedAt: Date.now() },
      },
    )

    // ✅ FIX 5: Clear recovery flag in session
    await db.collection("sessions").updateOne({ token: sessionId }, { $unset: { recoveryLogin: "" } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Add passkey POST error:", error)
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
  // Simple CBOR parsing for attestation object
  // In production, use a proper CBOR library

  // Find authData in the CBOR structure
  // For "none" attestation, authData starts after CBOR map header

  // Skip to authData (simplified - assumes "none" attestation format)
  // authData structure: rpIdHash (32) + flags (1) + signCount (4) + attestedCredentialData (variable)

  let offset = 0

  // Skip CBOR header and find authData
  // This is a simplified parser - in production use cbor library
  while (offset < attestationObject.length) {
    if (attestationObject[offset] === 0x68 && attestationObject[offset + 1] === 0x61) {
      // "authData" key found
      break
    }
    offset++
  }

  // Find the byte string for authData
  while (
    offset < attestationObject.length &&
    attestationObject[offset] !== 0x58 &&
    attestationObject[offset] !== 0x59
  ) {
    offset++
  }

  let authDataLength = 0
  if (attestationObject[offset] === 0x58) {
    // 1-byte length
    authDataLength = attestationObject[offset + 1]
    offset += 2
  } else if (attestationObject[offset] === 0x59) {
    // 2-byte length
    authDataLength = (attestationObject[offset + 1] << 8) | attestationObject[offset + 2]
    offset += 3
  }

  const authData = attestationObject.slice(offset, offset + authDataLength)

  // Parse authData
  const rpIdHash = authData.slice(0, 32)
  const flags = authData[32]
  const signCount = new DataView(authData.buffer, authData.byteOffset + 33, 4).getUint32(0, false)

  // Flags
  const up = (flags & 0x01) !== 0 // User Present
  const uv = (flags & 0x04) !== 0 // User Verified
  const be = (flags & 0x08) !== 0 // Backup Eligible
  const bs = (flags & 0x10) !== 0 // Backup State
  const at = (flags & 0x40) !== 0 // Attested Credential Data present

  let publicKey = ""
  if (at && authData.length > 37) {
    // Parse attested credential data
    const aaguid = authData.slice(37, 53)
    const credIdLength = (authData[53] << 8) | authData[54]
    const credId = authData.slice(55, 55 + credIdLength)
    const publicKeyBytes = authData.slice(55 + credIdLength)

    // Convert COSE public key to SPKI format (simplified)
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
