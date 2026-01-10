/**
 * User session store operations
 */

import { userDb } from "../../user-db"
import type { UserSession } from "@/types/entities/user.types"

/**
 * Save user session
 */
export async function saveUserSession(session: Omit<UserSession, "id" | "createdAt">): Promise<void> {
  await userDb.userSession.put({
    id: "current",
    ...session,
    createdAt: Date.now(),
  })
}

/**
 * Get current user session
 */
export async function getUserSession(): Promise<UserSession | undefined> {
  const session = await userDb.userSession.get("current")
  if (session && session.expiresAt > Date.now()) {
    return session
  }
  // Session expired, clear it
  if (session) {
    await clearUserSession()
  }
  return undefined
}

/**
 * Clear user session
 */
export async function clearUserSession(): Promise<void> {
  await userDb.userSession.delete("current")
}

/**
 * Get current user ID from session
 */
export async function getCurrentUserId(): Promise<string | null> {
  const session = await getUserSession()
  return session?.userId || null
}
