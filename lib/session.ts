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
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    if (session.lastAccessedAt < oneDayAgo) {
      const newExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
      await db
        .collection("sessions")
        .updateOne(
          { token: sessionToken },
          { $set: { lastAccessedAt: new Date(), expiresAt: newExpiresAt } }
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

  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7);
  const client = await getMongoClient();
  const db = client.db("skylog");

  // We search for the token in the _id field OR the sessionToken field
  // and ensure the numeric expiresAt is in the future
  const session = await db.collection("sessions").findOne({
    $or: [{ _id: token }, { sessionToken: token }],
    expiresAt: { $gt: Date.now() },
  });

  if (!session) {
    return null;
  }

  // IMPORTANT: Fetch the user to get the callsign (since it's not in the session doc)
  const user = await db.collection("users").findOne({ _id: session.userId });

  if (!user) {
    return null;
  }

  return {
    userId: session.userId,
    callsign: user.identity?.callsign || "Pilot", // Access the correct nested path
    expiresAt: new Date(session.expiresAt),
  };
}
