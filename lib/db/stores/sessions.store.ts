/**
 * Sessions Store - Local session management
 */

import { userDb } from "../user-db"
import type { LocalSession } from "@/types/entities/user.types"

const SESSION_KEY = "current"

/**
 * Get current user session
 */
export async function getUserSession(): Promise<LocalSession | null> {
  const session = await userDb.sessions.get(SESSION_KEY)
  if (!session) return null

  // Check if expired
  if (session.expiresAt < Date.now()) {
    await clearUserSession()
    return null
  }

  return session
}

/**
 * Save user session
 */
export async function saveUserSession(session: Omit<LocalSession, "id">): Promise<void> {
  await userDb.sessions.put({
    ...session,
    id: SESSION_KEY,
  })
}

/**
 * Clear user session (logout)
 */
export async function clearUserSession(): Promise<void> {
  await userDb.sessions.delete(SESSION_KEY)
}

/**
 * Check if user is authenticated
 */
export async function isAuthenticated(): Promise<boolean> {
  const session = await getUserSession()
  return session !== null
}
