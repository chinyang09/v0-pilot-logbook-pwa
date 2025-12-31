import { NextResponse } from "next/server";
import { getDB } from "@/lib/mongodb";
import { cookies } from "next/headers";
import type { User } from "@/lib/auth-types";

// GET /api/auth/session - Get current session
export async function GET() {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get("session")?.value;

    if (!sessionId) {
      return NextResponse.json({ authenticated: false });
    }

    const db = await getDB();

    // Find session
    const session = await db.collection("sessions").findOne({
      _id: sessionId,
      expiresAt: { $gt: Date.now() },
    });

    if (!session) {
      // Clear invalid cookie
      cookieStore.delete("session");
      return NextResponse.json({ authenticated: false });
    }

    // Extend session if more than 1 day old
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const lastUpdate = session.updatedAt || session.createdAt;

    if (lastUpdate < oneDayAgo) {
      const newExpiry = Date.now() + 30 * 24 * 60 * 60 * 1000;

      await db
        .collection("sessions")
        .updateOne(
          { _id: sessionId },
          { $set: { expiresAt: newExpiry, updatedAt: Date.now() } }
        );
      cookieStore.set("session", sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60,
        path: "/",
      });
    }

    return NextResponse.json({
      authenticated: true,
      user: {
        id: session.userId,
        callsign: session.callsign, // Use the denormalized callsign
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
      await db.collection("sessions").deleteOne({ _id: sessionId });
      cookieStore.delete("session");
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Logout error:", error);
    return NextResponse.json({ error: "Logout failed" }, { status: 500 });
  }
}
