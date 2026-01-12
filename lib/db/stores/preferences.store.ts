/**
 * Preferences Store - User preferences
 */

import { userDb } from "../user-db"

/**
 * Get preference by key
 */
export async function getPreference<T = unknown>(key: string): Promise<T | null> {
  const pref = await userDb.preferences.get(key)
  return pref ? (pref.value as T) : null
}

/**
 * Set preference
 */
export async function setPreference<T = unknown>(key: string, value: T): Promise<void> {
  await userDb.preferences.put({ key, value })
}

/**
 * Delete preference
 */
export async function deletePreference(key: string): Promise<void> {
  await userDb.preferences.delete(key)
}

/**
 * Get all preferences
 */
export async function getAllPreferences(): Promise<Record<string, unknown>> {
  const prefs = await userDb.preferences.toArray()
  return prefs.reduce(
    (acc, p) => {
      acc[p.key] = p.value
      return acc
    },
    {} as Record<string, unknown>,
  )
}
