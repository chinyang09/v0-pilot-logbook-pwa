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
import {
  AIRPORT_DATA_VERSION,
  AIRPORT_SOURCE_URL,
  writeAirportRows,
  type AirportSeedMessage,
} from "./airport-seed"
import type { Airport } from "@/types/entities/airport.types"
import { tzFormatter, tzOffsetName, offsetHoursFromName } from "@/lib/utils/tz-format"
import { icaoForIataAt } from "@/lib/airports/code-changes"

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

const DATA_VERSION = AIRPORT_DATA_VERSION

// ============================================
// Public API - Data Loading
// ============================================

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
 * Every write to `referenceDb.airports` starts in THIS FILE — the seed (which
 * may run in `airport-seed.worker.ts`, and is counted when it reports done),
 * add-custom and toggle-favorite — so this stays trustworthy as long as new
 * writers bump it too.
 */
let airportsRevision = 0

/** The current airports-table revision. See `airportsRevision`. */
export function getAirportsRevision(): number {
  return airportsRevision
}


/**
 * How far a seed has got, 0..1, for anyone waiting on it.
 *
 * A first seed takes seconds on a fresh device, and the import awaits it
 * before parsing — so a new user's first import (a LogTen migration, very
 * often) sat on an unmoving "Reading 5%" for ~14s. The import dialog
 * subscribes and shows it; nothing else needs to.
 */
const seedListeners = new Set<(fraction: number) => void>()
export function onAirportSeedProgress(listener: (fraction: number) => void): () => void {
  seedListeners.add(listener)
  return () => {
    seedListeners.delete(listener)
  }
}

let rebuildInFlight: Promise<Airport[]> | null = null

function rebuildAirportsTable(rawData: Record<string, any>): Promise<Airport[]> {
  // Two hooks mounting together used to seed the table twice over.
  rebuildInFlight ??= seedAirportsTable(rawData).finally(() => {
    rebuildInFlight = null
  })
  return rebuildInFlight
}

async function seedAirportsTable(rawData: Record<string, any>): Promise<Airport[]> {
  const airports = await writeAirportRows(rawData, (done) => seedListeners.forEach((listener) => listener(done)))
  airportsRevision++
  return airports
}

/**
 * Whether the table is known to hold the whole bundled dataset. Until it does,
 * a lookup that finds nothing means "not written YET", not "no such airport" —
 * a new install seeds ~29k rows over ~15s, and a flight opened in that window
 * read its airports as missing and saved its night time and landings as zeros.
 */
let airportsSeeded = false
export function isAirportTableSeeded(): boolean {
  return airportsSeeded
}

/**
 * Seed from the bundled file — in a WORKER where one can be started.
 *
 * The file is 5.7MB of JSON, and `response.json()` parses it on the calling
 * thread: on the main thread that was a ~500ms task (4× CPU throttle) on the
 * tap that opened a new install's first flight, followed by ~120 chunked
 * writes each serialising its rows on the main thread too. The worker does the
 * fetch, the parse, the mapping and every write, so the page only hears the
 * progress and the end. The table, the chunking and the version stamp are the
 * same code either way (`writeAirportRows`). With no worker (or one that will
 * not start) it runs here, as it always did.
 */
let sourceSeedInFlight: Promise<void> | null = null

function seedFromSource(): Promise<void> {
  sourceSeedInFlight ??= (async () => {
    try {
      if (!(await seedInWorker())) {
        const response = await fetch(AIRPORT_SOURCE_URL)
        if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`)
        await rebuildAirportsTable(await response.json())
      }
      airportsSeeded = true
    } finally {
      sourceSeedInFlight = null
    }
  })()
  return sourceSeedInFlight
}

/** True when the worker seeded the table; false when no worker could run it. */
function seedInWorker(): Promise<boolean> {
  if (typeof Worker === "undefined") return Promise.resolve(false)
  let worker: Worker
  try {
    worker = new Worker(new URL("./airport-seed.worker.ts", import.meta.url), { type: "module" })
  } catch {
    return Promise.resolve(false)
  }
  return new Promise<boolean>((resolve, reject) => {
    let started = false
    worker.onmessage = ({ data }: MessageEvent<AirportSeedMessage>) => {
      started = true
      if (data.type === "progress") {
        seedListeners.forEach((listener) => listener(data.done))
        return
      }
      worker.terminate()
      if (data.type === "done") {
        airportsRevision++
        resolve(true)
      } else {
        reject(new Error(data.error))
      }
    }
    // A worker that never got going (its script would not load) is not an
    // answer about the data: run the seed here instead.
    worker.onerror = (event) => {
      event.preventDefault()
      worker.terminate()
      if (started) reject(new Error(event.message || "Airport seed worker failed"))
      else resolve(false)
    }
    worker.postMessage({ type: "seed" })
  })
}

/**
 * Make sure the bundled airport dataset is in IndexedDB, WITHOUT reading it
 * back. The table is otherwise only seeded by the hooks that list airports
 * (the airports page, the flight form), so a pilot who opened the app on the
 * logbook and imported a report straight away ran every lookup against an
 * empty table: a Local Base report could not resolve its own base, every
 * sector failed to convert to UTC and was dropped in silence, and the review
 * then offered to delete the flights it should have matched. Anything that
 * resolves airports in bulk (the report imports) calls this first.
 *
 * Concurrent callers share one load. Never throws — a failed load leaves the
 * table as it was, and the caller's own lookups decide what that means.
 */
let ensureAirportsInFlight: Promise<void> | null = null

export function ensureAirportDatabase(): Promise<void> {
  if (!ensureAirportsInFlight) {
    ensureAirportsInFlight = (async () => {
      try {
        const [storedVersion, count] = await Promise.all([
          referenceDb.getMetadata("airport_version"),
          referenceDb.airports.count(),
        ])
        if (storedVersion === DATA_VERSION && count > 0) {
          airportsSeeded = true
          return
        }
        await seedFromSource()
      } catch (error) {
        console.error("[Airport DB] Could not seed the airports table:", error)
      }
    })().finally(() => {
      ensureAirportsInFlight = null
    })
  }
  return ensureAirportsInFlight
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
      airportsSeeded = true
      return await referenceDb.airports.toArray()
    }

    // Fetch from public/airports.min.json
    console.log("[Airport DB] Cache miss or update. Loading local file...")
    await seedFromSource()
    return await referenceDb.airports.toArray()
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
 * Get airport by IATA code, as the code stood at `atMs` (epoch ms; now when
 * omitted). A code that has moved between airports (`lib/airports/code-changes.ts`
 * — VTZ, VOVZ → VOVI) is answered by the airport it meant THEN, and by nothing
 * if that airport is not on the device: the other row still carrying the code
 * is not an answer for that instant. Any other code is its one airport.
 */
export async function getAirportByIata(iata: string, atMs?: number): Promise<Airport | undefined> {
  if (!iata) return undefined
  const dated = icaoForIataAt(iata, atMs)
  if (dated) return referenceDb.airports.get(dated)
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
 * Get airport local time display string
 */
export function getAirportLocalTime(tz: string): string {
  try {
    const now = new Date()
    const offsetStr = tzOffsetName(tz, "shortOffset", now) || "UTC"
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
 * Returns offset in hours (e.g., +8 for Singapore, -5 for New York, +5.5 for
 * India), as at `at` (default now — pass the flight's instant where DST could
 * differ).
 */
export function getAirportTimeInfo(tz: string, at: Date = new Date()): { offset: number; offsetStr: string } {
  try {
    const offset = offsetHoursFromName(tzOffsetName(tz, "longOffset", at))
    const offsetStr = tzOffsetName(tz, "shortOffset", at) || "UTC"

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
