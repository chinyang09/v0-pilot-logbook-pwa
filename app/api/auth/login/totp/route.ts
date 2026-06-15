import { type NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/mongodb";
import { verifyTOTPWithCounter } from "@/lib/auth/server/totp";
import { normalizeCallsign } from "@/lib/auth/shared/cuid";
import type { User } from "@/lib/auth/types";
import { issueSession, setSessionCookie } from "@/lib/auth/server/session";

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

    // Throttle brute-force: a 6-digit code with a ±1 window leaves only a
    // handful of valid values at any instant, so cap wrong guesses.
    const MAX_TOTP_ATTEMPTS = 5;
    const LOCKOUT_MS = 15 * 60 * 1000;
    const lockUntil = user.auth.totpLockUntil ?? 0;
    if (lockUntil > Date.now()) {
      return NextResponse.json(
        { error: "Too many attempts. Try again later." },
        { status: 429 }
      );
    }

    // Verify TOTP code
    const { valid, counter } = await verifyTOTPWithCounter(user.auth.totpSecret, code);

    // Replay protection: reject a code whose time-step was already used.
    const lastCounter = user.auth.lastTotpCounter ?? -1;
    if (!valid || counter <= lastCounter) {
      const failCount = (user.auth.totpFailCount ?? 0) + 1;
      const lock = failCount >= MAX_TOTP_ATTEMPTS;
      await db.collection<User>("users").updateOne(
        { _id: user._id },
        {
          $set: lock
            ? { "auth.totpFailCount": 0, "auth.totpLockUntil": Date.now() + LOCKOUT_MS }
            : { "auth.totpFailCount": failCount },
        }
      );
      return NextResponse.json(
        { error: "Invalid verification code" },
        { status: 401 }
      );
    }

    // Success: advance the replay counter and clear any failure state.
    await db.collection<User>("users").updateOne(
      { _id: user._id },
      {
        $set: { "auth.lastTotpCounter": counter },
        $unset: { "auth.totpFailCount": "", "auth.totpLockUntil": "" },
      }
    );

    // Issue a recovery session (drives the "add a passkey" nudge afterwards).
    const userIdString = user._id.toString();
    const { token: sessionId, expiresAt: sessionExpiry } = await issueSession(db, {
      userId: userIdString,
      callsign: user.identity.callsign,
      deviceId: deviceId || "unknown_device",
      recoveryLogin: true,
    });
    await setSessionCookie(sessionId);

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
