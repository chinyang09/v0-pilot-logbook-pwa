import { type NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/mongodb";
import { verifyTOTP } from "@/lib/auth/server/totp";
import { normalizeCallsign, createId } from "@/lib/auth/shared/cuid";
import type { User } from "@/lib/auth/types";
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
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    // Verify TOTP code
    const isValid = await verifyTOTP(user.auth.totpSecret, code);

    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid verification code" },
        { status: 401 }
      );
    }

    // Create session identifiers and dates
    const sessionId = createId();
    const now = new Date(); // Use Date Object
    const sessionExpiry = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // Use Date Object
    const userIdString = user._id.toString();

    // Store session in MongoDB
    await db.collection("sessions").updateOne(
      {
        userId: userIdString,
        deviceId: deviceId || "unknown_device",
      },
      {
        $set: {
          // Use 'token' to match the lookup in lib/session.ts
          token: sessionId, //_id
          userId: userIdString,
          callsign: user.identity.callsign,
          expiresAt: sessionExpiry, // Stored as BSON Date
          lastAccessedAt: now, // Stored as BSON Date
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
        expiresAt: sessionExpiry.getTime(), // Send as number (timestamp) to frontend
      },
      shouldRegisterPasskey: true,
    });
  } catch (error) {
    console.error("TOTP login error:", error);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
