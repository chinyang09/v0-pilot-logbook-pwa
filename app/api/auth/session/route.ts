import { NextResponse } from "next/server";
import { getDB } from "@/lib/mongodb";
import { cookies } from "next/headers";
import { setSessionCookie, clearSessionCookie } from "@/lib/auth/server/session";

// GET /api/auth/session - Get current session
export async function GET() {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get("session")?.value;

    if (!sessionId) {
      return NextResponse.json({ authenticated: false });
    }

    const db = await getDB();

    // ✅ FIX 1: Search by 'token' and compare using BSON Date
    const session = await db.collection("sessions").findOne({
      token: sessionId,
      expiresAt: { $gt: new Date() },
    });

    if (!session) {
      // Clear invalid cookie
      await clearSessionCookie();
      return NextResponse.json({ authenticated: false });
    }

    const now = new Date();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const lastUpdate =
      session.lastAccessedAt || session.updatedAt || session.createdAt;

    if (lastUpdate < oneDayAgo) {
      const newExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await db.collection("sessions").updateOne(
        { token: sessionId },
        {
          $set: {
            expiresAt: newExpiry,
            lastAccessedAt: now,
            updatedAt: now,
          },
        }
      );

      await setSessionCookie(sessionId);
    }

    return NextResponse.json({
      authenticated: true,
      user: {
        id: session.userId,
        callsign: session.callsign,
      },
      recoveryLogin: session.recoveryLogin || false,
    });
  } catch (error) {
    console.error("Session check error:", error);
    return NextResponse.json({ authenticated: false });
  }
}

// DELETE /api/auth/session - Logout
export async function DELETE() {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get("session")?.value;

    if (sessionId) {
      const db = await getDB();
      await db.collection("sessions").deleteOne({ token: sessionId });
      await clearSessionCookie();
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Logout error:", error);
    return NextResponse.json({ error: "Logout failed" }, { status: 500 });
  }
}
