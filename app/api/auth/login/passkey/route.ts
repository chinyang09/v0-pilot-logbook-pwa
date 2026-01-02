export const dynamic = "force-dynamic";
export const revalidate = 0;

import { type NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/mongodb";
import {
  generateAuthenticationOptions,
  base64URLEncode,
  base64URLDecode,
} from "@/lib/webauthn";
import type { User } from "@/lib/auth-types";
import { cookies } from "next/headers";
import { createId } from "@/lib/cuid";

// GET /api/auth/login/passkey - Get authentication options
export async function GET() {
  try {
    // Generate authentication options without specifying credentials
    // This enables discoverable credential (username-less) login
    const options = generateAuthenticationOptions();
    const challengeBase64 = base64URLEncode(options.challenge as Uint8Array);

    const db = await getDB();
    // Store challenge in MongoDB instead of memory
    await db.collection("challenges").updateOne(
      { _id: challengeBase64 },
      {
        $set: {
          challenge: challengeBase64,
          expiresAt: Date.now() + 60000,
        },
      },
      { upsert: true }
    );

    return NextResponse.json({
      challenge: challengeBase64,
      rpId: options.rpId,
      timeout: options.timeout,
      userVerification: options.userVerification,
    });
  } catch (error) {
    console.error("Passkey auth options error:", error);
    return NextResponse.json(
      { error: "Failed to generate options" },
      { status: 500 }
    );
  }
}

// POST /api/auth/login/passkey - Verify passkey and login
export async function POST(request: NextRequest) {
  try {
    const { credential, challenge, deviceId } = await request.json();
    const db = await getDB();

    const storedChallenge = await db.collection("challenges").findOneAndDelete({
      _id: challenge,
    });

    if (!storedChallenge || storedChallenge.expiresAt < Date.now()) {
      return NextResponse.json(
        { error: "Challenge expired or invalid" },
        { status: 400 }
      );
    }

    // Find user by credential ID
    const credentialId = credential.id;
    const user = await db.collection<User>("users").findOne({
      "auth.passkeys.id": credentialId,
    });

    if (!user) {
      return NextResponse.json({ error: "Passkey not found" }, { status: 401 });
    }

    // Find the specific passkey
    const passkey = user.auth.passkeys.find((p) => p.id === credentialId);
    if (!passkey) {
      return NextResponse.json({ error: "Passkey not found" }, { status: 401 });
    }

    const authData = base64URLDecode(credential.response.authenticatorData);
    const newCounter = new DataView(
      authData.buffer,
      authData.byteOffset + 33,
      4
    ).getUint32(0, false);

    // If phone has a lower counter than iPad, we take the highest one to avoid blocking
    const finalCounter = Math.max(newCounter, passkey.counter);
    // Update counter in database
    await db.collection<User>("users").updateOne(
      { _id: user._id, "auth.passkeys.id": credentialId },
      {
        $set: {
          "auth.passkeys.$.counter": finalCounter,
          updatedAt: Date.now(),
        },
      }
    );

    // Create session
    const sessionId = createId();
    const now = Date.now();
    const sessionExpiry = now + 30 * 24 * 60 * 60 * 1000; // 30 days

    const userIdString = user._id.toString();

    await db.collection("sessions").updateOne(
      {
        userId: userIdString, //match by string
        deviceId: deviceId || "unknown_device",
      },
      {
        $set: {
          _id: sessionId, // The new token
          sessionToken: sessionId,
          callsign: user.identity.callsign, // Added at onset per your idea
          expiresAt: sessionExpiry,
          updatedAt: now,
        },
      },
      { upsert: true }
    );

    // Set session cookie
    const cookieStore = await cookies();
    cookieStore.set("session", sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60,
      path: "/",
    });

    return NextResponse.json({
      success: true,
      user: {
        id: user._id,
        callsign: user.identity.callsign,
      },
      session: {
        token: sessionId,
        expiresAt: sessionExpiry,
      },
    });
  } catch (error) {
    console.error("Passkey login error:", error);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
