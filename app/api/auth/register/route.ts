import { type NextRequest, NextResponse } from "next/server";
import type { User, WebAuthnChallenge } from "@/lib/auth-types";

// In-memory challenge store (use Redis in production)
const challenges = new Map<string, WebAuthnChallenge>();

// POST /api/auth/register - Start registration
export async function POST(request: NextRequest) {
  try {
    const { getDB } = await import("@/lib/mongodb");
    const { createId, normalizeCallsign } = await import("@/lib/cuid");
    const { generateTOTPSecret, generateTOTPUri } = await import("@/lib/totp");
    const { generateRegistrationOptions, base64URLEncode } = await import(
      "@/lib/webauthn"
    );

    const { callsign } = await request.json();
    if (
      !callsign ||
      typeof callsign !== "string" ||
      callsign.trim().length < 2
    ) {
      return NextResponse.json(
        { error: "Callsign must be at least 2 characters" },
        { status: 400 }
      );
    }

    const normalizedCallsign = normalizeCallsign(callsign.trim());
    const db = await getDB();

    const existingUser = await db.collection<User>("users").findOne({
      "identity.searchKey": normalizedCallsign,
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "This callsign is already taken" },
        { status: 409 }
      );
    }

    const userId = createId();
    const totpSecret = generateTOTPSecret();
    const totpUri = generateTOTPUri(totpSecret, callsign.trim());

    // Generate WebAuthn registration options
    const registrationOptions = generateRegistrationOptions(
      userId,
      callsign.trim(),
      []
    );
    const challengeBase64 = base64URLEncode(
      registrationOptions.challenge as Uint8Array
    );

    // --- CHANGE HERE: Store in MongoDB instead of Map ---
    await db.collection("challenges").insertOne({
      _id: challengeBase64,
      challenge: challengeBase64,
      expiresAt: Date.now() + 60000, // Use Date object for TTL index (currently debugging using timevalue instead.)
      userId,
      type: "registration",
    });

    return NextResponse.json({
      userId,
      callsign: callsign.trim(),
      totpSecret,
      totpUri,
      registrationOptions: {
        ...registrationOptions,
        challenge: challengeBase64,
        user: {
          ...registrationOptions.user,
          id: base64URLEncode(registrationOptions.user.id as Uint8Array),
        },
        excludeCredentials: [],
      },
    });
  } catch (error) {
    console.error("Registration start error:", error);
    return NextResponse.json({ error: "Registration failed" }, { status: 500 });
  }
}

// GET /api/auth/register/challenge - Get stored challenge
export async function GET(request: NextRequest) {
  const challengeId = request.nextUrl.searchParams.get("challenge");
  if (!challengeId) {
    return NextResponse.json({ error: "Challenge required" }, { status: 400 });
  }

  const { getDB } = await import("@/lib/mongodb");
  const db = await getDB();

  // --- CHANGE HERE: Find in MongoDB ---
  const storedChallenge = await db
    .collection("challenges")
    .findOne({ _id: challengeId });

  /*if (
    !storedChallenge ||
    (storedChallenge.expiresAt instanceof Date &&
      storedChallenge.expiresAt.getTime() < Date.now())
  )*/
  if (!storedChallenge || storedChallenge.expiresAt < Date.now()) {
    return NextResponse.json(
      { error: "Challenge expired or not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({ valid: true, userId: storedChallenge.userId });
}
