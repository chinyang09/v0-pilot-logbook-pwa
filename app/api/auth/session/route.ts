import { NextResponse } from "next/server";
import { getDB } from "@/lib/mongodb";
import { cookies } from "next/headers";
import { setSessionCookie, clearSessionCookie, assertSameOrigin } from "@/lib/auth/server/session";

// This endpoint is per-request and must never be cached by a CDN, a proxy or
// the browser — a cached "authenticated: true" would outlive a revoked session.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

// GET /api/auth/session - Get current session
export async function GET() {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get("session")?.value;

    if (!sessionId) {
      return NextResponse.json({ authenticated: false }, { headers: NO_STORE });
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
      return NextResponse.json({ authenticated: false }, { headers: NO_STORE });
    }

    const now = new Date();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const lastUpdate =
      session.lastAccessedAt || session.updatedAt || session.createdAt;

    // Track the authoritative expiry so it can be reported back to the client.
    let expiresAt: Date =
      session.expiresAt instanceof Date
        ? session.expiresAt
        : new Date(session.expiresAt);

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
      expiresAt = newExpiry;
    }

    return NextResponse.json(
      {
        authenticated: true,
        user: {
          id: session.userId,
          callsign: session.callsign,
        },
        // The server SLIDES this expiry forward on every access past a day, but
        // the client's IndexedDB mirror was only ever written at login. On a
        // device in daily use the server session lives indefinitely while the
        // mirror silently aged out at exactly 30 days — and `getUserSession()`
        // deletes an expired mirror, so the next cold start found no session
        // and demanded a fresh login for no reason the user could see. Reporting
        // the real expiry lets the client keep its mirror in step.
        expiresAt: expiresAt.getTime(),
        recoveryLogin: session.recoveryLogin || false,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    // A thrown error here means we could not REACH the answer — a MongoDB cold
    // start, a pool timeout, a transient Atlas blip. It is NOT the server
    // saying "this session is invalid", and answering `authenticated: false`
    // with a 200 told every client exactly that, signing the user out over a
    // backend hiccup. 503 lets the client treat it as inconclusive and keep
    // working from local data.
    console.error("Session check error:", error);
    return NextResponse.json(
      { error: "Session check unavailable", retryable: true },
      { status: 503, headers: NO_STORE },
    );
  }
}

// DELETE /api/auth/session - Logout
export async function DELETE(request: Request) {
  // Forced logout is a nuisance rather than a breach, but it is still a
  // state change driven by a cookie, so it gets the same guard as the rest.
  if (!assertSameOrigin(request)) {
    return NextResponse.json(
      { error: "Cross-origin request rejected" },
      { status: 403, headers: NO_STORE },
    );
  }

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
