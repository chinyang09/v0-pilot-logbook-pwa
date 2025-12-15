/**
 * Aircraft Database Loader
 * Loads aircraft data from CDN gzip file and caches in IndexedDB via Dexie
 * Provides search and lookup functionality
 */

import pako from "pako"
import { db } from "./indexed-db"

export interface AircraftData {
  icao24: string // Unique transponder code
  registration: string
  manufacturericao: string
  manufacturername: string
  model: string
  typecode: string
  serialnumber: string
  linenumber: string
  icaoaircrafttype: string
  operator: string
  operatorcallsign: string
  operatoricao: string
  operatoriata: string
  owner: string
  testreg: string
  registered: string
  reguntil: string
  status: string
  built: string
  firstflightdate: string
  seatconfiguration: string
  engines: string
  modes: string
  adsb: string
  acars: string
  notes: string
  categoryDescription: string
}

// Normalized aircraft for display and search
export interface NormalizedAircraft {
  registration: string
  icao24: string
  manufacturer: string
  model: string
  typecode: string
  operator: string
  owner: string
  serial: string
  built: string
  status: string
  category: string
}

const AIRCRAFT_CDN_URL = "https://cdn.jsdelivr.net/gh/chinyang09/Aircraft-Database@master/basic-ac-db.json.gz"
const CACHE_VERSION_KEY = "aircraft-database-version"
const CACHE_VERSION = "1.4"

/**
 * Decompress gzip data using pako library
 */
function decompressGzip(compressedData: ArrayBuffer): string {
  const uint8Array = new Uint8Array(compressedData)

  console.log("[Aircraft DB] Compressed data size:", uint8Array.length, "bytes")
  console.log("[Aircraft DB] Magic bytes:", uint8Array[0]?.toString(16), uint8Array[1]?.toString(16))

  try {
    const decompressed = pako.ungzip(uint8Array)
    console.log("[Aircraft DB] Decompressed size:", decompressed.length, "bytes")

    // Use TextDecoder for proper UTF-8 decoding
    const decoder = new TextDecoder("utf-8")
    const text = decoder.decode(decompressed)

    console.log("[Aircraft DB] Decoded text length:", text.length)
    return text
  } catch (e) {
    console.error("[Aircraft DB] Pako ungzip failed:", e)
    throw e
  }
}

/**
 * Load aircraft from CDN gzip file
 */
async function loadAircraftFromCDN(): Promise<AircraftData[]> {
  console.log("[Aircraft DB] Loading from CDN...")

  const response = await fetch(AIRCRAFT_CDN_URL, {
    cache: "no-cache",
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  // Get raw bytes
  const arrayBuffer = await response.arrayBuffer()
  console.log("[Aircraft DB] Downloaded", (arrayBuffer.byteLength / 1024 / 1024).toFixed(2), "MB")

  // Check if data is gzipped by looking at magic bytes (1f 8b)
  const uint8 = new Uint8Array(arrayBuffer)
  const isGzipped = uint8[0] === 0x1f && uint8[1] === 0x8b

  let jsonText: string

  if (isGzipped) {
    console.log("[Aircraft DB] Data is gzipped, decompressing...")
    jsonText = decompressGzip(arrayBuffer)
  } else {
    console.log("[Aircraft DB] Data is not gzipped, parsing directly...")
    const decoder = new TextDecoder("utf-8")
    jsonText = decoder.decode(arrayBuffer)
  }

  // Clean up JSON text
  jsonText = jsonText.trim()
  // Remove BOM if present
  if (jsonText.charCodeAt(0) === 0xfeff) {
    jsonText = jsonText.slice(1)
  }

  console.log("[Aircraft DB] Parsing JSON...")
  const data = JSON.parse(jsonText)

  // Handle both array and object formats
  const aircraftArray = Array.isArray(data) ? data : Object.values(data)

  console.log("[Aircraft DB] Loaded", aircraftArray.length, "aircraft records")
  return aircraftArray as AircraftData[]
}

/**
 * Store aircraft data in Dexie IndexedDB
 */
async function storeInDexie(aircraft: AircraftData[]): Promise<void> {
  console.log("[Aircraft DB] Storing in Dexie...")

  // Clear existing data
  await db.aircraftDatabase.clear()

  // Store each aircraft as JSON string (to handle large dataset efficiently)
  const batchSize = 1000
  let stored = 0

  for (let i = 0; i < aircraft.length; i += batchSize) {
    const batch = aircraft.slice(i, i + batchSize)
    const records = batch
      .filter((ac) => ac.registration) // Only store aircraft with registration
      .map((ac) => ({
        registration: ac.registration.toUpperCase(),
        data: JSON.stringify(ac),
      }))

    await db.aircraftDatabase.bulkPut(records)
    stored += records.length
  }

  localStorage.setItem(CACHE_VERSION_KEY, CACHE_VERSION)
  console.log("[Aircraft DB] Stored", stored, "aircraft in Dexie")
}

/**
 * Load aircraft data from Dexie IndexedDB
 */
async function loadFromDexie(): Promise<AircraftData[]> {
  console.log("[Aircraft DB] Loading from Dexie cache...")

  const records = await db.aircraftDatabase.toArray()
  const aircraft = records.map((r) => JSON.parse(r.data) as AircraftData)

  console.log("[Aircraft DB] Loaded", aircraft.length, "aircraft from Dexie")
  return aircraft
}

/**
 * Check if we have cached aircraft data
 */
function hasCachedData(): boolean {
  return localStorage.getItem(CACHE_VERSION_KEY) === CACHE_VERSION
}

// In-memory cache for fast searching
let aircraftCache: AircraftData[] | null = null
let loadingPromise: Promise<AircraftData[]> | null = null

/**
 * Initialize and get aircraft database
 */
export async function getAircraftDatabase(): Promise<AircraftData[]> {
  // Return from memory cache if available
  if (aircraftCache && aircraftCache.length > 0) {
    return aircraftCache
  }

  // If already loading, wait for that promise
  if (loadingPromise) {
    return loadingPromise
  }

  loadingPromise = (async () => {
    try {
      // Try loading from Dexie first
      if (hasCachedData()) {
        const cached = await loadFromDexie()
        if (cached.length > 0) {
          aircraftCache = cached
          return cached
        }
      }

      // Load from CDN
      console.log("[Aircraft DB] No valid cache, loading from CDN...")
      const aircraft = await loadAircraftFromCDN()

      // Store in Dexie for offline use
      await storeInDexie(aircraft)

      aircraftCache = aircraft
      return aircraft
    } catch (error) {
      console.error("[Aircraft DB] Failed to initialize:", error)

      // Try loading from Dexie as fallback
      try {
        const cached = await loadFromDexie()
        if (cached.length > 0) {
          aircraftCache = cached
          return cached
        }
      } catch {
        // Ignore fallback errors
      }

      return []
    } finally {
      loadingPromise = null
    }
  })()

  return loadingPromise
}

/**
 * Normalize aircraft data for display
 */
export function normalizeAircraft(aircraft: AircraftData): NormalizedAircraft {
  return {
    registration: aircraft.registration || "",
    icao24: aircraft.icao24 || "",
    manufacturer: aircraft.manufacturername || aircraft.manufacturericao || "",
    model: aircraft.model || "",
    typecode: aircraft.typecode || "",
    operator: aircraft.operator || "",
    owner: aircraft.owner || "",
    serial: aircraft.serialnumber || "",
    built: aircraft.built || "",
    status: aircraft.status || "",
    category: aircraft.categoryDescription || aircraft.icaoaircrafttype || "",
  }
}

/**
 * Search aircraft by registration, typecode, model, or manufacturer
 */
export function searchAircraft(aircraft: AircraftData[], query: string, limit = 50): NormalizedAircraft[] {
  if (!query || query.length < 2) return []

  const q = query.toLowerCase().trim()
  const matches: Array<{ aircraft: AircraftData; score: number }> = []

  for (const ac of aircraft) {
    if (!ac.registration) continue

    let score = 0
    const reg = (ac.registration || "").toLowerCase()
    const typecode = (ac.typecode || "").toLowerCase()
    const model = (ac.model || "").toLowerCase()
    const manufacturer = (ac.manufacturername || "").toLowerCase()
    const operator = (ac.operator || "").toLowerCase()
    const icao24 = (ac.icao24 || "").toLowerCase()

    // Exact registration match (highest priority)
    if (reg === q) {
      score = 1000
    }
    // Registration starts with query
    else if (reg.startsWith(q)) {
      score = 900
    }
    // Registration contains query
    else if (reg.includes(q)) {
      score = 800
    }
    // Exact typecode match
    else if (typecode === q) {
      score = 700
    }
    // Typecode starts with query
    else if (typecode.startsWith(q)) {
      score = 600
    }
    // ICAO24 match
    else if (icao24 === q || icao24.startsWith(q)) {
      score = 550
    }
    // Model contains query
    else if (model.includes(q)) {
      score = 500
    }
    // Manufacturer contains query
    else if (manufacturer.includes(q)) {
      score = 400
    }
    // Operator contains query
    else if (operator.includes(q)) {
      score = 300
    }

    if (score > 0) {
      matches.push({ aircraft: ac, score })
    }

    // Early exit for performance
    if (matches.length > limit * 2) {
      break
    }
  }

  // Sort by score descending
  matches.sort((a, b) => b.score - a.score)

  return matches.slice(0, limit).map((m) => normalizeAircraft(m.aircraft))
}

/**
 * Get aircraft by registration
 */
export function getAircraftByRegistration(
  aircraft: AircraftData[],
  registration: string,
): NormalizedAircraft | undefined {
  const found = aircraft.find((ac) => ac.registration?.toUpperCase() === registration.toUpperCase())
  return found ? normalizeAircraft(found) : undefined
}

/**
 * Get aircraft by ICAO24 transponder code
 */
export function getAircraftByIcao24(aircraft: AircraftData[], icao24: string): NormalizedAircraft | undefined {
  const found = aircraft.find((ac) => ac.icao24?.toLowerCase() === icao24.toLowerCase())
  return found ? normalizeAircraft(found) : undefined
}

/**
 * Format aircraft for display
 */
export function formatAircraft(aircraft: NormalizedAircraft): string {
  const parts = [aircraft.registration]
  if (aircraft.typecode) parts.push(`(${aircraft.typecode})`)
  if (aircraft.model) parts.push(`- ${aircraft.model}`)
  if (aircraft.manufacturer) parts.push(`by ${aircraft.manufacturer}`)
  return parts.join(" ")
}

/**
 * Get database loading status
 */
export function isAircraftDatabaseLoaded(): boolean {
  return aircraftCache !== null && aircraftCache.length > 0
}

/**
 * Clear aircraft cache (useful for forcing reload)
 */
export async function clearAircraftCache(): Promise<void> {
  aircraftCache = null
  localStorage.removeItem(CACHE_VERSION_KEY)
  await db.aircraftDatabase.clear()
}
