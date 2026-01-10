import { type NextRequest, NextResponse } from "next/server"
import { getDB } from "@/lib/mongodb"
import { base64URLDecode, base64URLEncode } from "@/lib/auth/server/webauthn"
import type { User, PasskeyCredential } from "@/lib/auth/types"
import { cookies } from "next/headers"
import { createId } from "@/lib/auth/shared/cuid"

// POST /api/auth/register/complete - Complete passkey registration
export async function POST(request: NextRequest) {
  try {
    const { userId, callsign, totpSecret, credential, challenge } = await request.json()

    if (!userId || !callsign || !totpSecret || !credential || !challenge) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const db = await getDB()

    // Parse the credential
    const credentialData = await parseClientCredential(credential)
    const userAgent = request.headers.get("user-agent") || "";

    const passkeyCredential: PasskeyCredential = {
      id: credentialData.credentialId,
      publicKey: credentialData.publicKey,
      counter: credentialData.counter,
      deviceType: credentialData.deviceType,
      backedUp: credentialData.backedUp,
      transports: credentialData.transports,
      createdAt: Date.now(),
      name: getDeviceName(userAgent),
    }

    const nowTimestamp = Date.now()
    const user: User = {
      _id: userId,
      identity: {
        callsign: callsign.trim(),
        searchKey: callsign.toLowerCase().replace(/\s+/g, ""),
      },
      auth: {
        totpSecret,
        totpEnabled: true,
        passkeys: [passkeyCredential],
      },
      createdAt: nowTimestamp,
      updatedAt: nowTimestamp,
    }

    // Insert user into database
    await db.collection<User>("users").insertOne(user)

    const sessionId = createId()
    const now = new Date() 
    const sessionExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

    await db.collection("sessions").insertOne({
      // We use 'token' for lookups, but keep _id as unique identifier
      token: sessionId, 
      userId,
      callsign: user.identity.callsign,
      createdAt: now,
      lastAccessedAt: now,
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

// Parse credential from client
async function parseClientCredential(credential: {
  id: string;
  rawId: string;
  response: {
    clientDataJSON: string;
    attestationObject: string;
    publicKey?: string;
    transports?: string[];
  };
  type: string;
  authenticatorAttachment?: string;
}) {
  // Decode attestationObject to get public key and other data
  const attestationObject = base64URLDecode(
    credential.response.attestationObject
  );
  const authData = parseAttestationObject(attestationObject);

  return {
    credentialId: credential.id,
    publicKey: credential.response.publicKey || authData.publicKey,
    counter: authData.counter,
    deviceType: authData.flags.be
      ? ("multiDevice" as const)
      : ("singleDevice" as const),
    backedUp: authData.flags.bs,
    transports: credential.response
      .transports as PasskeyCredential["transports"],
  };
}

// Parse attestation object (CBOR)
function parseAttestationObject(attestationObject: Uint8Array) {
  // Simple CBOR parsing for attestation object
  // In production, use a proper CBOR library

  // Find authData in the CBOR structure
  // For "none" attestation, authData starts after CBOR map header

  // Skip to authData (simplified - assumes "none" attestation format)
  // authData structure: rpIdHash (32) + flags (1) + signCount (4) + attestedCredentialData (variable)

  let offset = 0;

  // Skip CBOR header and find authData
  // This is a simplified parser - in production use cbor library
  while (offset < attestationObject.length) {
    if (
      attestationObject[offset] === 0x68 &&
      attestationObject[offset + 1] === 0x61
    ) {
      // "authData" key found
      break;
    }
    offset++;
  }

  // Find the byte string for authData
  while (
    offset < attestationObject.length &&
    attestationObject[offset] !== 0x58 &&
    attestationObject[offset] !== 0x59
  ) {
    offset++;
  }

  let authDataLength = 0;
  if (attestationObject[offset] === 0x58) {
    // 1-byte length
    authDataLength = attestationObject[offset + 1];
    offset += 2;
  } else if (attestationObject[offset] === 0x59) {
    // 2-byte length
    authDataLength =
      (attestationObject[offset + 1] << 8) | attestationObject[offset + 2];
    offset += 3;
  }

  const authData = attestationObject.slice(offset, offset + authDataLength);

  // Parse authData
  const rpIdHash = authData.slice(0, 32);
  const flags = authData[32];
  const signCount = new DataView(
    authData.buffer,
    authData.byteOffset + 33,
    4
  ).getUint32(0, false);

  // Flags
  const up = (flags & 0x01) !== 0; // User Present
  const uv = (flags & 0x04) !== 0; // User Verified
  const be = (flags & 0x08) !== 0; // Backup Eligible
  const bs = (flags & 0x10) !== 0; // Backup State
  const at = (flags & 0x40) !== 0; // Attested Credential Data present

  let publicKey = "";
  if (at && authData.length > 37) {
    // Parse attested credential data
    const aaguid = authData.slice(37, 53);
    const credIdLength = (authData[53] << 8) | authData[54];
    const credId = authData.slice(55, 55 + credIdLength);
    const publicKeyBytes = authData.slice(55 + credIdLength);

    // Convert COSE public key to SPKI format (simplified)
    publicKey = base64URLEncode(publicKeyBytes);
  }

  return {
    rpIdHash: base64URLEncode(rpIdHash),
    flags: { up, uv, be, bs, at },
    counter: signCount,
    publicKey,
  };
}

function getDeviceName(ua: string): string {
  if (ua.includes("iPhone")) return "iPhone";
  if (ua.includes("iPad")) return "iPad";
  if (ua.includes("Macintosh") || ua.includes("Mac OS X")) return "Mac";
  if (ua.includes("Android")) return "Android Device";
  if (ua.includes("Windows")) return "Windows PC";
  if (ua.includes("Linux")) return "Linux Device";
  return "New Device";
}
