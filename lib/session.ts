import { cookies } from "next/headers";
import { getMongoClient } from "./mongodb";

export interface SessionData {
  userId: string;
  callsign: string;
  expiresAt: number;
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
      _id: sessionToken,
      expiresAt: { $gt: Date.now() },
    });

    if (!session) {
      return null;
    }

    // Extend session if it's been more than a day since last access
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    if (session.lastAccessedAt < oneDayAgo) {
      const newExpiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
      await db
        .collection("sessions")
        .updateOne(
          { sessionToken: sessionToken },
          { $set: { lastAccessedAt: Date.now(), expiresAt: newExpiresAt } }
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
    _id: token,
    expiresAt: { $gt: Date.now() }, // Numeric comparison
  });

  if (!session) return null;

  return {
    userId: session.userId,
    callsign: session.callsign || "Pilot", // No need to fetch user!
    expiresAt: session.expiresAt,
  };
}
