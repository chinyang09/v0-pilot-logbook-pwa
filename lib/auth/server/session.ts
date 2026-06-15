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
}

/**
 * Create (or, per-device, refresh) a MongoDB session and return its token.
 * Centralizes the token/expiry generation that previously lived—slightly
 * differently—in every auth route.
 */
export async function issueSession(
  db: Db,
  { userId, callsign, deviceId, recoveryLogin = false }: IssueSessionInput,
): Promise<{ token: string; expiresAt: Date }> {
  const token = createId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  const base = { token, userId, callsign, expiresAt, lastAccessedAt: now, updatedAt: now };

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
