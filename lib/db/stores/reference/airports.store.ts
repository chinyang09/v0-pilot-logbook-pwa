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

/** Map the raw airports JSON into our Airport rows, re-flagging known favorites. */
function mapRawAirports(rawData: Record<string, any>, favoriteIcaos: Set<string>): Airport[] {
  return Object.values(rawData)
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
}

/**
 * Rebuild the airports table from a fresh dataset, preserving the user's
 * favorites and custom airports. Both are derived from a single full scan —
 * the previous code scanned twice (once via a broken `where("isFavorite")
 * .equals(1)` index query that never matched the boolean values actually
 * stored, silently dropping favorites on every dataset version bump).
 */
/**
 * Bumped by every write to the airports table, so a cached in-memory copy can
 * tell whether it is still current.
 *
 * `useAirportDatabase` used to re-read the WHOLE table from IndexedDB on every
 * mount — ten thousand records deserialised each time the flight form opened,
 * i.e. on every flight tap — because a blind reload was the only way it could
 * notice an airport added by the import enricher (which writes to Dexie
 * directly, not through the hook). A counter says the same thing precisely:
 * the hook reloads when something actually changed and skips otherwise.
 *
 * Every write to `referenceDb.airports` lives in THIS FILE — the three
 * functions below are the complete set — so this stays trustworthy as long as
 * new writers bump it too.
 */
let airportsRevision = 0

/** The current airports-table revision. See `airportsRevision`. */
export function getAirportsRevision(): number {
  return airportsRevision
}

async function rebuildAirportsTable(rawData: Record<string, any>): Promise<Airport[]> {
  const existing = await referenceDb.airports.toArray()
  const favoriteIcaos = new Set(existing.filter((a) => a.isFavorite).map((a) => a.icao))
  const customAirports = existing.filter((a) => a.isCustom === true)

  const airports = mapRawAirports(rawData, favoriteIcaos)
  const newIcaos = new Set(airports.map((a) => a.icao))
  const customToPreserve = customAirports.filter((a) => !newIcaos.has(a.icao))

  await referenceDb.transaction("rw", referenceDb.airports, referenceDb.metadata, async () => {
    await referenceDb.airports.clear()
    await referenceDb.airports.bulkPut(airports)
    if (customToPreserve.length > 0) {
      await referenceDb.airports.bulkPut(customToPreserve)
    }
    await referenceDb.setMetadata("airport_version", DATA_VERSION)
  })
  airportsRevision++

  return airports
}

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
    return await rebuildAirportsTable(rawData)
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

    // Code matches (ICAO/IATA) — highest priority
    if (icao === q) score = 1000
    else if (iata === q) score = 950
    else if (icao.startsWith(q)) score = 900
    else if (iata.startsWith(q)) score = 800
    // Name/city matches — lower priority
    else if (name.startsWith(q)) score = 300
    else if (city.startsWith(q)) score = 250
    else if (q.length >= 3 && name.includes(q)) score = 100
    else if (q.length >= 3 && city.includes(q)) score = 50

    if (score > 0) matches.push({ airport, score })
  }

  // Sort by score descending — preserves ICAO/IATA matches above name matches
  return matches
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((m) => m.airport)
}

/**
 * Check if any airport has an exact ICAO or IATA code match for the query.
 * Used to determine if FR24 online search should be triggered.
 */
export function hasExactAirportCodeMatch(airports: Airport[], query: string): boolean {
  if (!query) return false
  const q = query.toUpperCase().trim()
  return airports.some((a) => a.icao === q || (a.iata && a.iata === q))
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
  await rebuildAirportsTable(rawData)
}

/**
 * Add custom airport
 * Returns the airport with a generated submissionId for server submission
 */
export async function addCustomAirport(airport: Omit<Airport, "id"> & { icao: string }): Promise<Airport> {
  const { createId } = await import("@/lib/auth/shared/cuid")
  const existingCount = await referenceDb.airports.count()
  const submissionId = airport.submissionId || createId()
  const newAirport: Airport = {
    ...airport,
    id: existingCount + 1,
    isCustom: true,
    submissionId,
  }
  await referenceDb.airports.put(newAirport)
  airportsRevision++
  return newAirport
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
  airportsRevision++
  return newStatus
}

/**
 * Get favorite airports. Filters rather than using the `isFavorite` index,
 * which never matched because favorites are stored as the boolean `true`
 * (IndexedDB can't key a boolean) rather than the numeric 1 the index expects.
 */
export async function getFavoriteAirports(): Promise<Airport[]> {
  const all = await referenceDb.airports.toArray()
  return all.filter((a) => !!a.isFavorite)
}

// ============================================
// Public API - Timezone Utilities
// ============================================

/**
 * `Intl.DateTimeFormat` instances, cached per (timezone × shape).
 *
 * Constructing one resolves locale and timezone data and is by far the most
 * expensive part of these helpers — and `getAirportTimeInfo` built TWO of them
 * on every call. That is fine for a detail panel and not fine for an import:
 * the logbook parser and the roster executor both resolve a departure and an
 * arrival offset per sector, so a report of a few hundred rows was constructing
 * formatters in the thousands.
 *
 * Caching the FORMATTER rather than the answer is what keeps this a pure
 * speed-up. A formatter is stateless — the DST-dependent part is the instant
 * you hand it, and every caller still passes the current one — whereas caching
 * an offset would pin whatever DST was in force the first time an airport was
 * seen.
 *
 * Keyed on the timezone string, which is a bounded set (the airports a pilot
 * flies to), and only populated for zones that actually resolve: an invalid one
 * throws out of the constructor and is left for the caller's catch.
 */
const tzFormatters = new Map<string, Intl.DateTimeFormat>()

function tzFormatter(
  tz: string,
  options: Omit<Intl.DateTimeFormatOptions, "timeZone">,
  cacheKey: string,
): Intl.DateTimeFormat {
  const key = `${tz}|${cacheKey}`
  const cached = tzFormatters.get(key)
  if (cached) return cached
  const made = new Intl.DateTimeFormat("en-US", { timeZone: tz, ...options })
  tzFormatters.set(key, made)
  return made
}

function offsetName(tz: string, style: "shortOffset" | "longOffset", at: Date): string {
  return (
    tzFormatter(tz, { timeZoneName: style }, style)
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value || ""
  )
}

/**
 * Get airport local time display string
 */
export function getAirportLocalTime(tz: string): string {
  try {
    const now = new Date()
    const offsetStr = offsetName(tz, "shortOffset", now) || "UTC"
    const timeStr = tzFormatter(
      tz,
      { hour: "2-digit", minute: "2-digit" },
      "hhmm",
    ).format(now)

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
    const offsetPart = offsetName(tz, "longOffset", now)
    const match = offsetPart.match(/([+-]\d+)/)
    const offset = match ? Number.parseInt(match[1]) : 0

    const offsetStr = offsetName(tz, "shortOffset", now) || "UTC"

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
 * Code → airport indexes, built once per ARRAY and cached against it.
 *
 * Both lookups below used to be `airports.find(a => a.code.toUpperCase() === …)`
 * over the whole reference table — roughly ten thousand rows, each one
 * allocating an uppercased string, for a single hit. The flight form does FOUR
 * of these every time it opens (two memos for the departure/arrival airport and
 * two more in the timezone effect), and again whenever either ICAO changes, so
 * opening one flight burned about forty thousand string allocations.
 *
 * A `WeakMap` keyed on the array itself means no call site changes and no
 * invalidation to get wrong: a new array (a reload, or `mutate` adding a custom
 * airport) is simply a different key, and the old index is collected with the
 * old array.
 *
 * `find` returns the FIRST match, so a duplicate code must not overwrite the
 * entry already in the map.
 */
const icaoIndexes = new WeakMap<Airport[], Map<string, Airport>>()
const iataIndexes = new WeakMap<Airport[], Map<string, Airport>>()

function codeIndex(
  cache: WeakMap<Airport[], Map<string, Airport>>,
  airports: Airport[],
  code: (a: Airport) => string | undefined,
): Map<string, Airport> {
  let index = cache.get(airports)
  if (!index) {
    index = new Map()
    for (const airport of airports) {
      const value = code(airport)
      if (!value) continue
      const key = value.toUpperCase()
      if (!index.has(key)) index.set(key, airport)
    }
    cache.set(airports, index)
  }
  return index
}

/**
 * @deprecated Use getAirportByIcao instead
 */
export const getAirportByICAO = (airports: Airport[], icao: string) =>
  codeIndex(icaoIndexes, airports, (a) => a.icao).get(icao.toUpperCase())

/**
 * @deprecated Use getAirportByIata instead
 */
export const getAirportByIATA = (airports: Airport[], iata: string) =>
  codeIndex(iataIndexes, airports, (a) => a.iata).get(iata.toUpperCase())
