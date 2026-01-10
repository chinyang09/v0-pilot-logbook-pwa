/**
 * User preferences store operations
 */

import { userDb } from "../../user-db"
import type { UserPreferences } from "@/types/db/stores.types"
import { DEFAULT_FIELD_ORDER } from "@/types/db/stores.types"

/**
 * Get user preferences
 */
export async function getUserPreferences(): Promise<UserPreferences | null> {
  const prefs = await userDb.preferences.get("user-prefs")
  return prefs || null
}

/**
 * Save user preferences
 */
export async function saveUserPreferences(prefs: Partial<UserPreferences>): Promise<void> {
  const existing = await getUserPreferences()

  const preferences: UserPreferences = {
    key: "user-prefs",
    fieldOrder: existing?.fieldOrder || DEFAULT_FIELD_ORDER,
    visibleFields: existing?.visibleFields || {},
    recentlyUsedAirports: existing?.recentlyUsedAirports || [],
    recentlyUsedAircraft: existing?.recentlyUsedAircraft || [],
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now(),
    ...prefs,
  }

  await userDb.preferences.put(preferences)
}

/**
 * Get default field order
 */
export function getDefaultFieldOrder() {
  return DEFAULT_FIELD_ORDER
}

/**
 * Add airport to recently used list
 */
export async function addRecentlyUsedAirport(icao: string): Promise<void> {
  const prefs = await getUserPreferences()
  const recentlyUsed = prefs?.recentlyUsedAirports || []

  // Remove if already exists, then add to front
  const filtered = recentlyUsed.filter((code) => code !== icao)
  const updated = [icao, ...filtered].slice(0, 10) // Keep only last 10

  await saveUserPreferences({ recentlyUsedAirports: updated })
}

/**
 * Get recently used airports
 */
export async function getRecentlyUsedAirports(): Promise<string[]> {
  const prefs = await getUserPreferences()
  return prefs?.recentlyUsedAirports || []
}

/**
 * Add aircraft to recently used list
 */
export async function addRecentlyUsedAircraft(registration: string): Promise<void> {
  const prefs = await getUserPreferences()
  const recentlyUsed = prefs?.recentlyUsedAircraft || []

  // Remove if already exists, then add to front
  const filtered = recentlyUsed.filter((reg) => reg !== registration)
  const updated = [registration, ...filtered].slice(0, 10) // Keep only last 10

  await saveUserPreferences({ recentlyUsedAircraft: updated })
}

/**
 * Get recently used aircraft
 */
export async function getRecentlyUsedAircraft(): Promise<string[]> {
  const prefs = await getUserPreferences()
  return prefs?.recentlyUsedAircraft || []
}
