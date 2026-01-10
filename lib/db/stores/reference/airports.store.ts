/**
 * Airports store operations (reference data)
 *
 * Combines:
 * - Local JSON loading and caching
 * - Search functionality
 * - Favorites and recents management
 * - Timezone utilities
 */

import { referenceDb } from "../../reference-db"
import type { Airport } from "@/types/entities/airport.types"

// ============================================
// Types (re-export for convenience)
// ============================================

export interface AirportData {
  id: number
  icao: string
  iata: string
  name: string
  city: string
  state: string
  country: string
  latitude: number
  longitude: number
  altitude: number
  tz: string
  source: string
}

// ============================================
// Configuration
// ============================================

const AIRPORT_SOURCE_URL = "/airports.min.json"
const DATA_VERSION = "2025.10.27-min"

// ============================================
// Public API - Data Loading
// ============================================

/**
 * Get airports from cache or load from local public folder
 */
export async function getAirportDatabase(): Promise<Airport[]> {
  try {
    const storedVersion = await referenceDb.getMetadata("airport_version")
    const count = await referenceDb.airports.count()

    // Check if cache is valid
    if (storedVersion === DATA_VERSION && count > 0) {
      return await referenceDb.airports.toArray()
    }

    // Fetch from public/airports.min.json
    console.log("[Airport DB] Cache miss or update. Loading local file...")
    const response = await fetch(AIRPORT_SOURCE_URL)
    if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`)

    const rawData: Record<string, any> = await response.json()

    // Get current favorites first
    const existingFavorites = await referenceDb.airports.where("isFavorite").equals(1).toArray()
    const favoriteIcaos = new Set(existingFavorites.map((a) => a.icao))

    // Map Object to Array and normalize keys
    const airports: Airport[] = Object.values(rawData)
      .map((airport: any, index: number) => ({
        id: index + 1,
        icao: airport.icao || "",
        iata: airport.iata || "",
        name: airport.name || "",
        city: airport.city || "",
        state: airport.state || "",
        country: airport.country || "",
        latitude: airport.lat || 0,
        longitude: airport.lon || 0,
        elevation: airport.elevation || 0,
        tz: airport.tz || "UTC",
        isFavorite: favoriteIcaos.has(airport.icao) ? true : undefined,
      }))
      .filter((a) => a.icao)

    // Update database
    await referenceDb.transaction("rw", referenceDb.airports, referenceDb.metadata, async () => {
      await referenceDb.airports.clear()
      await referenceDb.airports.bulkPut(airports)
      await referenceDb.setMetadata("airport_version", DATA_VERSION)
    })

    return airports
  } catch (error) {
    console.error("[Airport DB] Critical failure:", error)
    return []
  }
}

// ============================================
// Public API - Search
// ============================================

/**
 * Search airports with scoring
 */
export function searchAirports(airports: Airport[], query: string, limit = 10): Airport[] {
  if (!query) return []

  const q = query.toLowerCase().trim()
  const matches: Array<{ airport: Airport; score: number }> = []

  for (const airport of airports) {
    let score = 0
    const icao = airport.icao.toLowerCase()
    const iata = airport.iata ? airport.iata.toLowerCase() : ""
    const name = airport.name.toLowerCase()
    const city = airport.city.toLowerCase()

    if (icao === q) score = 1000
    else if (icao.startsWith(q)) score = 900
    else if (iata === q) score = 850
    else if (iata.startsWith(q)) score = 750
    else if (name.startsWith(q)) score = 600
    else if (city.startsWith(q)) score = 500
    else if (name.includes(q)) score = 300
    else if (city.includes(q)) score = 200

    if (score > 0) matches.push({ airport, score })
  }

  return matches
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((m) => m.airport)
}

// ============================================
// Public API - CRUD Operations
// ============================================

/**
 * Get all airports
 */
export async function getAllAirports(): Promise<Airport[]> {
  return referenceDb.airports.toArray()
}

/**
 * Get airport by ICAO code
 */
export async function getAirportByIcao(icao: string): Promise<Airport | undefined> {
  if (!icao) return undefined
  return referenceDb.airports.get(icao.toUpperCase())
}

/**
 * Get airport by IATA code
 */
export async function getAirportByIata(iata: string): Promise<Airport | undefined> {
  return referenceDb.airports.where("iata").equals(iata.toUpperCase()).first()
}

/**
 * Get airport by ID
 */
export async function getAirportById(id: number): Promise<Airport | undefined> {
  return referenceDb.airports.where("id").equals(id).first()
}

/**
 * Bulk load airports from JSON data
 */
export async function bulkLoadAirports(rawData: Record<string, any>): Promise<void> {
  // Get current favorites first
  const existingFavorites = await referenceDb.airports.where("isFavorite").equals(1).toArray()
  const favoriteIcaos = new Set(existingFavorites.map((a) => a.icao))

  const airports: Airport[] = Object.values(rawData)
    .map((airport: any, index: number) => ({
      id: index + 1,
      icao: airport.icao || "",
      iata: airport.iata || "",
      name: airport.name || "",
      city: airport.city || "",
      state: airport.state || "",
      country: airport.country || "",
      latitude: airport.lat || 0,
      longitude: airport.lon || 0,
      elevation: airport.elevation || 0,
      tz: airport.tz || "UTC",
      isFavorite: favoriteIcaos.has(airport.icao) ? true : undefined,
    }))
    .filter((a) => a.icao)

  await referenceDb.transaction("rw", referenceDb.airports, referenceDb.metadata, async () => {
    await referenceDb.airports.clear()
    await referenceDb.airports.bulkPut(airports)
    await referenceDb.setMetadata("airport_version", DATA_VERSION)
  })
}

/**
 * Add custom airport
 */
export async function addCustomAirport(airport: Omit<Airport, "id"> & { icao: string }): Promise<void> {
  const existingCount = await referenceDb.airports.count()
  await referenceDb.airports.put({
    ...airport,
    id: existingCount + 1,
  } as Airport)
}

// ============================================
// Public API - Favorites
// ============================================

/**
 * Toggle airport favorite status
 */
export async function toggleAirportFavorite(icao: string): Promise<boolean> {
  const airport = await referenceDb.airports.get(icao.toUpperCase())
  if (!airport) return false

  const newStatus = !airport.isFavorite
  await referenceDb.airports.update(icao.toUpperCase(), { isFavorite: newStatus })
  return newStatus
}

/**
 * Get favorite airports
 */
export async function getFavoriteAirports(): Promise<Airport[]> {
  return referenceDb.airports.where("isFavorite").equals(1).toArray()
}

// ============================================
// Public API - Timezone Utilities
// ============================================

/**
 * Get airport local time display string
 */
export function getAirportLocalTime(tz: string): string {
  try {
    const now = new Date()
    const offsetStr =
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        timeZoneName: "shortOffset",
      })
        .formatToParts(now)
        .find((p) => p.type === "timeZoneName")?.value || "UTC"

    const timeStr = now.toLocaleTimeString("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
    })

    return `${timeStr} (${offsetStr})`
  } catch {
    return "Time Unavailable"
  }
}

/**
 * Get numeric timezone offset for an airport timezone
 * Returns offset in hours (e.g., +8 for Singapore, -5 for New York)
 */
export function getAirportTimeInfo(tz: string): { offset: number; offsetStr: string } {
  try {
    const now = new Date()
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "longOffset",
    }).formatToParts(now)

    const offsetPart = parts.find((p) => p.type === "timeZoneName")?.value || ""
    const match = offsetPart.match(/([+-]\d+)/)
    const offset = match ? Number.parseInt(match[1]) : 0

    const shortParts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "shortOffset",
    }).formatToParts(now)
    const offsetStr = shortParts.find((p) => p.type === "timeZoneName")?.value || "UTC"

    return { offset, offsetStr }
  } catch {
    return { offset: 0, offsetStr: "UTC" }
  }
}

/**
 * Format airport for display
 */
export function formatAirport(airport: Airport): string {
  const parts = [airport.icao]
  if (airport.iata) parts.push(`(${airport.iata})`)
  parts.push(`- ${airport.name}`)
  if (airport.city) parts.push(`- ${airport.city}, ${airport.country}`)

  const localTime = getAirportLocalTime(airport.tz)
  return `${parts.join(" ")} [Local: ${localTime}]`
}

// ============================================
// Legacy API - kept for backward compatibility
// ============================================

/**
 * @deprecated Use getAirportByIcao instead
 */
export const getAirportByICAO = (airports: Airport[], icao: string) =>
  airports.find((a) => a.icao.toUpperCase() === icao.toUpperCase())

/**
 * @deprecated Use getAirportByIata instead
 */
export const getAirportByIATA = (airports: Airport[], iata: string) =>
  airports.find((a) => a.iata && a.iata.toUpperCase() === iata.toUpperCase())
