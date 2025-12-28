import { cookies } from "next/headers"
import { getMongoClient } from "./mongodb"

export interface SessionData {
  userId: string
  callsign: string
  expiresAt: Date
}

export async function validateSession(): Promise<SessionData | null> {
  try {
    const cookieStore = await cookies()
    const sessionToken = cookieStore.get("session")?.value

    if (!sessionToken) {
      return null
    }

    const client = await getMongoClient()
    const db = client.db("skylog")

    const session = await db.collection("sessions").findOne({
      token: sessionToken,
      expiresAt: { $gt: new Date() },
    })

    if (!session) {
      return null
    }

    // Extend session if it's been more than a day since last access
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    if (session.lastAccessedAt < oneDayAgo) {
      const newExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
      await db
        .collection("sessions")
        .updateOne({ token: sessionToken }, { $set: { lastAccessedAt: new Date(), expiresAt: newExpiresAt } })
    }

    return {
      userId: session.userId,
      callsign: session.callsign,
      expiresAt: session.expiresAt,
    }
  } catch (error) {
    console.error("Session validation error:", error)
    return null
  }
}

export async function validateSessionFromHeader(request: Request): Promise<SessionData | null> {
  try {
    const authHeader = request.headers.get("Authorization")
    const userId = request.headers.get("X-User-Id")

    if (!authHeader?.startsWith("Bearer ") || !userId) {
      return null
    }

    const sessionToken = authHeader.slice(7)

    const client = await getMongoClient()
    const db = client.db("skylog")

    const session = await db.collection("sessions").findOne({
      token: sessionToken,
      userId: userId,
      expiresAt: { $gt: new Date() },
    })

    if (!session) {
      return null
    }

    return {
      userId: session.userId,
      callsign: session.callsign,
      expiresAt: session.expiresAt,
    }
  } catch (error) {
    console.error("Session header validation error:", error)
    return null
  }
}
