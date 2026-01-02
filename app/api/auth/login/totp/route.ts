import { type NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/mongodb";
import { verifyTOTP } from "@/lib/totp";
import { normalizeCallsign, createId } from "@/lib/cuid";
import type { User } from "@/lib/auth-types";
import { cookies } from "next/headers";

// POST /api/auth/login/totp - Recovery login with TOTP
export async function POST(request: NextRequest) {
  try {
    const { callsign, code, deviceId } = await request.json();

    if (!callsign || !code) {
      return NextResponse.json(
        { error: "Callsign and code required" },
        { status: 400 }
      );
    }

    const db = await getDB();
    const searchKey = normalizeCallsign(callsign.trim());
    const user = await db.collection<User>("users").findOne({
      "identity.searchKey": searchKey,
    });

    if (!user) {
      // Don't reveal whether user exists
      return NextResponse.json(
        { error: "Invalid callsign or code" },
        { status: 401 }
      );
    }

    // Verify TOTP code
    const isValid = await verifyTOTP(user.auth.totpSecret, code);

    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid callsign or code" },
        { status: 401 }
      );
    }

    // Create session
    const sessionId = createId();
    const now = Date.now();
    const sessionExpiry = now + 30 * 24 * 60 * 60 * 1000; // 30 days
    const userIdString = user._id.toString();

    await db.collection("sessions").updateOne(
      {
        userId: userIdString,
        deviceId: deviceId || "unknown_recovery_device",
      },
      {
        $set: {
          _id: sessionId,
          sessionToken: sessionId,
          userId: userIdString,
          callsign: user.identity.callsign, // Denormalized for fast sync
          expiresAt: sessionExpiry,
          updatedAt: now,
          recoveryLogin: true,
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
        id: userIdString,
        callsign: user.identity.callsign,
      },
      session: {
        token: sessionId,
        expiresAt: sessionExpiry,
      },
      // Flag to prompt passkey registration on new device
      shouldRegisterPasskey: true,
    });
  } catch (error) {
    console.error("TOTP login error:", error);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
