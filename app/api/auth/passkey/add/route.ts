import { type NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/mongodb";
import { generateRegistrationOptions, base64URLEncode } from "@/lib/auth/server/webauthn";
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

    // ✅ FIX 2: Store challenge expiresAt as a Date object
    await db.collection<StoredChallenge>("challenges").insertOne({
      _id: challengeBase64,
      userId: user._id,
      expiresAt: new Date(Date.now() + 60000),
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

    // ✅ FIX 3: Query challenge using Date object
    const storedChallenge = await db
      .collection<StoredChallenge>("challenges")
      .findOne({ _id: challenge });

    if (storedChallenge) {
      await db.collection("challenges").deleteOne({ _id: challenge });
    }

    if (!storedChallenge || storedChallenge.expiresAt < new Date()) {
      return NextResponse.json({ error: "Challenge expired" }, { status: 400 });
    }

    const cookieStore = await cookies();
    const sessionId = cookieStore.get("session")?.value;

    // Use 'token' field to match session lookup (sessions are stored with token, not _id)
    const session = await db.collection("sessions").findOne({
      token: sessionId,
      expiresAt: { $gt: new Date() },
    });

    if (!session || session.userId !== storedChallenge.userId) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const newPasskey: PasskeyCredential = {
      id: credential.id,
      publicKey: credential.response.publicKey || "",
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      transports: credential.response.transports,
      createdAt: Date.now(), // Passkey internal metadata can remain numbers or change to Dates
      name: name || getDeviceName(),
    };

    await db.collection<User>("users").updateOne(
      { _id: session.userId },
      {
        $push: { "auth.passkeys": newPasskey },
        $set: { updatedAt: Date.now() },
      }
    );

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

function getDeviceName(): string {
  if (typeof navigator === "undefined") return "Unknown Device";

  const ua = navigator.userAgent;
  if (ua.includes("iPhone")) return "iPhone";
  if (ua.includes("iPad")) return "iPad";
  if (ua.includes("Mac")) return "Mac";
  if (ua.includes("Android")) return "Android";
  if (ua.includes("Windows")) return "Windows PC";
  return "Device";
}
