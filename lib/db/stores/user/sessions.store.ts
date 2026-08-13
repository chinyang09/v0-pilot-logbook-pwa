/**
 * User session store operations
 */

import { userDb } from "../../user-db"
import type { UserSession } from "@/types/entities/user.types"

/**
 * Save user session
 */
export async function saveUserSession(session: Omit<UserSession, "id" | "createdAt">): Promise<void> {
  // The session SECRET is deliberately dropped on the floor here.
  //
  // It lives in the HttpOnly `session` cookie, which JavaScript cannot read —
  // that is the whole point of HttpOnly. Keeping a second copy in IndexedDB so
  // it could be sent as an `Authorization: Bearer` header put a 30-day
  // credential somewhere any XSS on the page could read it, and somewhere it
  // survived a restart. Every request the app makes is same-origin, so the
  // browser attaches the cookie by itself and nothing needs the token.
  //
  // This mirror is now only an offline-readable record of WHO is signed in and
  // until when — no secret, so nothing to steal.
  const { sessionToken: _discarded, ...safe } = session

  await userDb.userSession.put({
    id: "current",
    ...safe,
    createdAt: Date.now(),
  })
}

/**
 * Get current user session
 */
export async function getUserSession(): Promise<UserSession | undefined> {
  const session = await userDb.userSession.get("current")
  if (session && session.expiresAt > Date.now()) {
    // Scrub a token written by a build from before the cookie migration. It is
    // a live credential sitting in IndexedDB, so it is removed on first read
    // rather than left until the user happens to log in again.
    if (session.sessionToken) {
      const { sessionToken: _stale, ...safe } = session
      await userDb.userSession.put(safe)
      console.log("[Auth] scrubbed legacy session token from local storage")
      return safe
    }
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
