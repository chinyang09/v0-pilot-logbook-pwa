import { type NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/mongodb";
import { base64URLDecode, base64URLEncode, generateRegistrationOptions } from "@/lib/webauthn";
import type { User, PasskeyCredential } from "@/lib/auth-types";
import { cookies } from "next/headers";
import { ObjectId } from "mongodb";

// GET: Generate options for an existing user to add a new device
export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get("session")?.value;
    if (!sessionId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const db = await getDB();
    const session = await db.collection("sessions").findOne({ _id: sessionId });
    if (!session) return NextResponse.json({ error: "Session expired" }, { status: 401 });

    const user = await db.collection<User>("users").findOne({ _id: session.userId });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    // Reuse your library's generator
    const existingPasskeyIds = user.auth.passkeys.map(p => p.id);
    const options = generateRegistrationOptions(
      user._id.toString(), 
      user.identity.callsign, 
      existingPasskeyIds
    );

    const challengeBase64 = base64URLEncode(options.challenge as Uint8Array);

    // Save challenge to MongoDB for verification in POST
    await db.collection("challenges").insertOne({
      _id: challengeBase64,
      challenge: challengeBase64,
      expiresAt: new Date(Date.now() + 60000),
      userId: user._id,
    });

    return NextResponse.json({
      ...options,
      challenge: challengeBase64,
      user: {
        ...options.user,
        id: base64URLEncode(options.user.id as Uint8Array),
      },
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to start registration" }, { status: 500 });
  }
}

// POST: Verify and PUSH the new passkey to the user array
export async function POST(request: NextRequest) {
  try {
    const { credential, challenge } = await request.json();
    const cookieStore = await cookies();
    const sessionId = cookieStore.get("session")?.value;

    if (!sessionId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const db = await getDB();
    const session = await db.collection("sessions").findOne({ _id: sessionId });
    if (!session) return NextResponse.json({ error: "Session expired" }, { status: 401 });

    // 1. Consume Challenge
    const stored = await db.collection("challenges").findOneAndDelete({ _id: challenge });
    if (!stored) return NextResponse.json({ error: "Challenge invalid" }, { status: 400 });

    // 2. Parse using YOUR existing logic from register/complete
    const credentialData = await parseClientCredential(credential);

    const newPasskey: PasskeyCredential = {
      id: credentialData.credentialId,
      publicKey: credentialData.publicKey,
      counter: credentialData.counter,
      deviceType: credentialData.deviceType,
      backedUp: credentialData.backedUp,
      transports: credentialData.transports,
      createdAt: Date.now(),
      name: getDeviceName(request.headers.get("user-agent") || ""),
    };

    // 3. ATOMIC PUSH to the array
    await db.collection("users").updateOne(
      { _id: session.userId },
      { 
        $push: { "auth.passkeys": newPasskey },
        $set: { updatedAt: Date.now() }
      }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Add passkey error:", error);
    return NextResponse.json({ error: "Failed to add passkey" }, { status: 500 });
  }
}

// Re-use your specific parsing logic
async function parseClientCredential(credential: any) {
  const attestationObject = base64URLDecode(credential.response.attestationObject);
  const authData = parseAttestationObject(attestationObject);
  return {
    credentialId: credential.id,
    publicKey: credential.response.publicKey || authData.publicKey,
    counter: authData.counter,
    deviceType: authData.flags.be ? ("multiDevice" as const) : ("singleDevice" as const),
    backedUp: authData.flags.bs,
    transports: credential.response.transports,
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
  if (ua.includes("iPhone")) return "iPhone";
  if (ua.includes("iPad")) return "iPad";
  if (ua.includes("Mac")) return "Mac";
  if (ua.includes("Android")) return "Android";
  return "Device";
}