import { type NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/mongodb";
import { generateRegistrationOptions, base64URLEncode } from "@/lib/webauthn";
import type {
  User,
  PasskeyCredential,
  StoredChallenge,
} from "@/lib/auth-types";
import { cookies } from "next/headers";

// GET /api/auth/passkey/add - Get registration options for adding a new passkey
export async function GET() {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get("session")?.value;

    if (!sessionId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const db = await getDB();

    // Verify session
    const session = await db.collection("sessions").findOne({
      _id: sessionId,
      expiresAt: { $gt: Date.now() },
    });

    if (!session) {
      return NextResponse.json({ error: "Session expired" }, { status: 401 });
    }

    // Get user
    const user = await db
      .collection<User>("users")
      .findOne({ _id: session.userId });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Generate registration options
    const options = generateRegistrationOptions(
      user._id,
      user.identity.callsign,
      user.auth.passkeys
    );

    const challengeBase64 = base64URLEncode(options.challenge as Uint8Array);

    // Store challenge
    await db.collection<StoredChallenge>("challenges").insertOne({
      _id: challengeBase64,
      userId: user._id,
      expiresAt: Date.now() + 60000, // 1 minute
    });

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

// POST /api/auth/passkey/add - Complete adding a new passkey
export async function POST(request: NextRequest) {
  try {
    const { credential, challenge, name } = await request.json();

    if (!credential || !challenge) {
      return NextResponse.json(
        { error: "Missing credential or challenge" },
        { status: 400 }
      );
    }

    const db = await getDB();

    // ✅ FIX 3: Retrieve and delete challenge from MongoDB
    const storedChallenge = await db
      .collection<StoredChallenge>("challenges")
      .findOne({ _id: challenge });

    // Always delete the challenge immediately to prevent replay
    if (storedChallenge) {
      await db.collection("challenges").deleteOne({ _id: challenge });
    }

    if (!storedChallenge || storedChallenge.expiresAt < Date.now()) {
      return NextResponse.json({ error: "Challenge expired" }, { status: 400 });
    }

    const cookieStore = await cookies();
    const sessionId = cookieStore.get("session")?.value;

    if (!sessionId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Verify session matches challenge
    const session = await db.collection("sessions").findOne({
      _id: sessionId,
      expiresAt: { $gt: Date.now() },
    });

    if (!session || session.userId !== storedChallenge.userId) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    // Create new passkey credential
    const newPasskey: PasskeyCredential = {
      id: credential.id,
      publicKey: credential.response.publicKey || "",
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      transports: credential.response.transports,
      createdAt: Date.now(),
      name: name || getDeviceName(),
    };

    // Add passkey to user
    await db.collection<User>("users").updateOne(
      { _id: session.userId },
      {
        $push: { "auth.passkeys": newPasskey },
        $set: { updatedAt: Date.now() },
      }
    );

    // Clear recovery login flag if set
    await db
      .collection("sessions")
      .updateOne({ _id: sessionId }, { $unset: { recoveryLogin: "" } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Passkey add error:", error);
    return NextResponse.json(
      { error: "Failed to add passkey" },
      { status: 500 }
    );
  }
}

function getDeviceName(): string {
  if (typeof navigator === "undefined") return "Unknown Device"

  const ua = navigator.userAgent
  if (ua.includes("iPhone")) return "iPhone"
  if (ua.includes("iPad")) return "iPad"
  if (ua.includes("Mac")) return "Mac"
  if (ua.includes("Android")) return "Android"
  if (ua.includes("Windows")) return "Windows PC"
  return "Device"
}
