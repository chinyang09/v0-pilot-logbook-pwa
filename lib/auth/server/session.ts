import { cookies } from "next/headers";
import type { Db } from "mongodb";
import { getMongoClient } from "@/lib/mongodb";
import { createId } from "@/lib/auth/shared/cuid";

export interface SessionData {
  userId: string;
  callsign: string;
  expiresAt: Date;
}

// Single source of truth for session lifetime + cookie attributes so every
// issuance path stays consistent (and is hardened in exactly one place).
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_MAX_AGE = SESSION_TTL_MS / 1000;
export const SESSION_COOKIE_NAME = "session";

const SESSION_COOKIE_OPTIONS = {
  httpOnly: true as const,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: SESSION_MAX_AGE,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

export interface IssueSessionInput {
  userId: string;
  callsign: string;
  /** When present, reuse the session row for this device instead of stacking a new one. */
  deviceId?: string;
  /** Mark this as a TOTP-recovery login (drives the "add a passkey" nudge). */
  recoveryLogin?: boolean;
  /** Raw request User-Agent, stored so the account page can label sessions by device. */
  userAgent?: string;
}

/**
 * Create (or, per-device, refresh) a MongoDB session and return its token.
 * Centralizes the token/expiry generation that previously lived—slightly
 * differently—in every auth route.
 */
export async function issueSession(
  db: Db,
  { userId, callsign, deviceId, recoveryLogin = false, userAgent }: IssueSessionInput,
): Promise<{ token: string; expiresAt: Date }> {
  const token = createId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  const base = {
    token,
    userId,
    callsign,
    expiresAt,
    lastAccessedAt: now,
    updatedAt: now,
    ...(userAgent ? { userAgent } : {}),
  };

  if (deviceId) {
    await db.collection("sessions").updateOne(
      { userId, deviceId },
      {
        $set: recoveryLogin ? { ...base, recoveryLogin: true } : base,
        // A real passkey login clears any stale recovery flag on the device row.
        ...(recoveryLogin ? {} : { $unset: { recoveryLogin: "" } }),
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    );
  } else {
    await db.collection("sessions").insertOne({
      ...base,
      createdAt: now,
      ...(recoveryLogin ? { recoveryLogin: true } : {}),
    });
  }

  return { token, expiresAt };
}

export async function validateSession(): Promise<SessionData | null> {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get("session")?.value;

    if (!sessionToken) {
      return null;
    }

    const client = await getMongoClient();
    const db = client.db("skylog");

    
    const session = await db.collection("sessions").findOne({
      token: sessionToken,
      expiresAt: { $gt: new Date() },
    });

    if (!session) {
      return null;
    }

    // Extend session if it's been more than a day since last access
    const now = new Date();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Ensure lastAccessedAt exists or fallback to createdAt
    const lastAccess =
      session.lastAccessedAt || session.createdAt || new Date(0);

    if (lastAccess < oneDayAgo) {
      const newExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
      await db.collection("sessions").updateOne(
        { token: sessionToken }, 
        { $set: { lastAccessedAt: now, expiresAt: newExpiresAt } }
      );
    }

    return {
      userId: session.userId,
      callsign: session.callsign,
      expiresAt: session.expiresAt,
    };
  } catch (error) {
    console.error("Session validation error:", error);
    return null;
  }
}

/**
 * @deprecated Legacy bearer-token authentication, kept only so a client running
 * a build from before the cookie migration keeps working through a rollout.
 *
 * The token it reads is the SAME secret as the session cookie, but a bearer
 * token has to be readable by JavaScript to be attached to a request — which
 * meant the client kept a 30-day credential in IndexedDB, where any XSS could
 * read and exfiltrate it. That completely defeated the HttpOnly cookie sitting
 * beside it. New code must use `validateRequestSession`; the client no longer
 * stores a token at all (see `saveUserSession`), so nothing should reach here.
 *
 * Safe to delete once no client is running a pre-migration build.
 */
export async function validateSessionFromHeader(
  request: Request
): Promise<SessionData | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  const client = await getMongoClient();
  const db = client.db("skylog");

  const session = await db.collection("sessions").findOne({
    token: token,
    expiresAt: { $gt: new Date() },
  });

  if (!session) return null;

  return {
    userId: session.userId,
    callsign: session.callsign || "Pilot",
    expiresAt:
      session.expiresAt instanceof Date
        ? session.expiresAt
        : new Date(session.expiresAt),
  };
}

/**
 * THE way an API route authenticates a request.
 *
 * Prefers the HttpOnly session cookie — a credential JavaScript cannot read, so
 * an XSS on the page cannot steal it — and falls back to the legacy bearer
 * header only for clients still running a pre-migration build.
 *
 * Cookie auth means CSRF becomes relevant, so a state-changing request must
 * ALSO pass `assertSameOrigin`. See that function for why `SameSite=Lax` alone
 * is not the whole answer.
 */
export async function validateRequestSession(
  request: Request
): Promise<SessionData | null> {
  const fromCookie = await validateSession();
  if (fromCookie) return fromCookie;
  return validateSessionFromHeader(request);
}

/**
 * Reject a state-changing request that did not originate from this app.
 *
 * The session cookie is `SameSite=Lax`, which already stops a cross-site POST
 * from carrying it — Lax only rides top-level GET navigations. This is the
 * second lock: Lax has known soft edges (some clients have treated a top-level
 * form POST leniently, and `SameSite` is only as good as the browser
 * implementing it), and once sync moved onto the cookie every mutating endpoint
 * became worth protecting properly.
 *
 * Checks `Origin`, falling back to `Referer` for the handful of clients that
 * omit Origin on same-origin requests. A request with NEITHER header is
 * allowed: same-origin GETs and some server-to-server callers legitimately send
 * neither, and rejecting those would break them without closing anything — a
 * browser-driven cross-site request always sends Origin.
 */
export function assertSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const stated = origin || referer;
  if (!stated) return true;

  // Compare against the host the request actually arrived on, so this works
  // across localhost, preview deployments and production without configuration.
  const host = request.headers.get("host");
  if (!host) return true;

  try {
    return new URL(stated).host === host;
  } catch {
    return false;
  }
}
