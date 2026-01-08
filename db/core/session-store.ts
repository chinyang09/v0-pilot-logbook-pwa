/**
 * User session management
 */
import { db } from "./database"
import type { UserSession } from "./core-types"

export async function saveUserSession(session: Omit<UserSession, "id" | "createdAt">): Promise<void> {
  await db.userSession.put({
    id: "current",
    ...session,
    createdAt: Date.now(),
  })
}

export async function getUserSession(): Promise<UserSession | undefined> {
  const session = await db.userSession.get("current")
  if (session && session.expiresAt > Date.now()) {
    return session
  }
  if (session) {
    await clearUserSession()
  }
  return undefined
}

export async function clearUserSession(): Promise<void> {
  await db.userSession.delete("current")
}

export async function getCurrentUserId(): Promise<string | null> {
  const session = await getUserSession()
  return session?.userId || null
}
