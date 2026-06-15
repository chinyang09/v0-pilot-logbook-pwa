import { type NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/mongodb";
import {
  generateRegistrationOptions,
  base64URLEncode,
  getRP,
  getExpectedOrigin,
  verifyRegistrationAttestation,
} from "@/lib/auth/server/webauthn";
import type {
  User,
  PasskeyCredential,
  StoredChallenge,
} from "@/lib/auth/types";
import { cookies } from "next/headers";

export async function GET(request: NextRequest) {
  try {
    // Get the host header for accurate RP ID in production
    const host = request.headers.get("host") || undefined;
    const cookieStore = await cookies();
    const sessionId = cookieStore.get("session")?.value;

    if (!sessionId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const db = await getDB();

    // Use 'token' field to match session lookup (sessions are stored with token, not _id)
    const session = await db.collection("sessions").findOne({
      token: sessionId,
      expiresAt: { $gt: new Date() },
    });

    if (!session) {
      return NextResponse.json({ error: "Session expired" }, { status: 401 });
    }

    const user = await db
      .collection<User>("users")
      .findOne({ _id: session.userId });
    if (!user)
      return NextResponse.json({ error: "User not found" }, { status: 404 });

    const options = generateRegistrationOptions(
      user._id,
      user.identity.callsign,
      user.auth.passkeys,
      host
    );
    const challengeBase64 = base64URLEncode(options.challenge as Uint8Array);

    await db.collection<StoredChallenge>("challenges").insertOne({
      _id: challengeBase64,
      userId: user._id,
      expiresAt: new Date(Date.now() + 60000),
      type: "add-passkey",
    } as any);

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
    });
  } catch (error) {
    console.error("Passkey add options error:", error);
    return NextResponse.json(
      { error: "Failed to generate options" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { credential, challenge, name } = await request.json();
    const db = await getDB();

    // Single-use challenge: consume atomically and confirm it was issued for an
    // add-passkey ceremony.
    const storedChallenge = (await db
      .collection<StoredChallenge>("challenges")
      .findOneAndDelete({ _id: challenge })) as unknown as StoredChallenge | null;

    if (!storedChallenge || storedChallenge.expiresAt < new Date()) {
      return NextResponse.json({ error: "Challenge expired" }, { status: 400 });
    }
    if (storedChallenge.type && storedChallenge.type !== "add-passkey") {
      return NextResponse.json({ error: "Invalid challenge" }, { status: 400 });
    }

    const cookieStore = await cookies();
    const sessionId = cookieStore.get("session")?.value;

    const session = await db.collection("sessions").findOne({
      token: sessionId,
      expiresAt: { $gt: new Date() },
    });

    if (!session || session.userId.toString() !== storedChallenge.userId.toString()) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    // Cryptographically verify the attestation before trusting any field from
    // the client (previously this route stored client-supplied values with no
    // verification, counter 0, and a possibly-empty public key).
    const host = request.headers.get("host") || undefined;
    const attestation = await verifyRegistrationAttestation(credential, challenge, {
      expectedRpId: getRP(host).id,
      expectedOrigin: getExpectedOrigin(host, request.headers.get("x-forwarded-proto") || undefined),
    });
    if (!attestation.verified) {
      return NextResponse.json({ error: attestation.error || "Invalid credential" }, { status: 400 });
    }

    const userAgent = request.headers.get("user-agent") || "";

    const newPasskey: PasskeyCredential = {
      id: attestation.credentialId,
      publicKey: attestation.publicKey,
      counter: attestation.counter,
      deviceType: attestation.deviceType,
      backedUp: attestation.backedUp,
      transports: attestation.transports,
      createdAt: Date.now(),
      name: name || getDeviceName(userAgent),
    };

    const updateResult = await db.collection<User>("users").updateOne(
      { _id: session.userId, "auth.passkeys.id": { $ne: attestation.credentialId } } as any,
      {
        $push: { "auth.passkeys": newPasskey } as any,
        $set: { updatedAt: Date.now() },
      }
    );

    if (updateResult.matchedCount === 0) {
      const exists = await db
        .collection("users")
        .findOne({ _id: session.userId as any, "auth.passkeys.id": attestation.credentialId });
      if (exists) return NextResponse.json({ success: true, alreadyRegistered: true });
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Clear recovery flag from session
    await db
      .collection("sessions")
      .updateOne({ token: sessionId }, { $unset: { recoveryLogin: "" } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Passkey add error:", error);
    return NextResponse.json(
      { error: "Failed to add passkey" },
      { status: 500 }
    );
  }
}

function getDeviceName(ua: string): string {
  if (ua.includes("iPhone")) return "iPhone";
  if (ua.includes("iPad")) return "iPad";
  if (ua.includes("Macintosh") || ua.includes("Mac OS X")) return "Mac";
  if (ua.includes("Android")) return "Android";
  if (ua.includes("Windows")) return "Windows PC";
  if (ua.includes("Linux")) return "Linux Device";
  return "New Device";
}
