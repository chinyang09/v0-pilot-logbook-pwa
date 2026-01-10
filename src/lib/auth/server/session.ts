import { cookies } from "next/headers";
import { getMongoClient } from "./mongodb";

export interface SessionData {
  userId: string;
  callsign: string;
  expiresAt: Date;
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
