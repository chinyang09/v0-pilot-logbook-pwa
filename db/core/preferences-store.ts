/**
 * User preferences management
 */
import { db } from "./database"
import type { UserPreferences } from "./core-types"

const DEFAULT_FIELD_ORDER = {
  flight: [
    "date",
    "flightNumber",
    "aircraftReg",
    "departureIcao",
    "departureIata",
    "arrivalIcao",
    "arrivalIata",
    "scheduledOut",
    "scheduledIn",
    "outTime",
    "offTime",
    "onTime",
    "inTime",
  ],
  time: ["total", "night", "p1us", "sicTime", "xc", "ifr", "actualInst", "simInst"],
  crew: ["pf", "picCrew", "sicCrew", "observer"],
  landings: ["dayTO", "dayLdg", "nightTO", "nightLdg", "autolands"],
  approaches: ["app1", "app2", "holds"],
  notes: ["remarks", "ipcIcc"],
}

export async function getUserPreferences(): Promise<UserPreferences | null> {
  return db.preferences.get("user-prefs") ?? null
}

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

  await db.preferences.put(preferences)
}

export async function getDefaultFieldOrder() {
  return DEFAULT_FIELD_ORDER
}

export async function addRecentlyUsedAirport(icao: string): Promise<void> {
  const prefs = await getUserPreferences()
  const recentlyUsed = prefs?.recentlyUsedAirports || []
  const filtered = recentlyUsed.filter((code) => code !== icao)
  const updated = [icao, ...filtered].slice(0, 10)
  await saveUserPreferences({ recentlyUsedAirports: updated })
}

export async function getRecentlyUsedAirports(): Promise<string[]> {
  const prefs = await getUserPreferences()
  return prefs?.recentlyUsedAirports || []
}

export async function addRecentlyUsedAircraft(registration: string): Promise<void> {
  const prefs = await getUserPreferences()
  const recentlyUsed = prefs?.recentlyUsedAircraft || []
  const filtered = recentlyUsed.filter((reg) => reg !== registration)
  const updated = [registration, ...filtered].slice(0, 10)
  await saveUserPreferences({ recentlyUsedAircraft: updated })
}

export async function getRecentlyUsedAircraft(): Promise<string[]> {
  const prefs = await getUserPreferences()
  return prefs?.recentlyUsedAircraft || []
}
