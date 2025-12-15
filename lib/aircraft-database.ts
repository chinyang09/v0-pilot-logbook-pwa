/**
 * Aircraft Database Loader
 * Loads aircraft data from CDN gzip file and caches in IndexedDB
 * Provides search and lookup functionality
 */

import pako from "pako"

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
const AIRCRAFT_CDN_URL_JSON = "https://cdn.jsdelivr.net/gh/chinyang09/Aircraft-Database@master/basic-ac-db.json"
const CACHE_KEY = "aircraft-database-cache"
const CACHE_VERSION_KEY = "aircraft-database-version"
const CACHE_VERSION = "1.3"
const DB_NAME = "aircraft-cache-db"
const STORE_NAME = "aircraft"

/**
 * Decompress gzip data using pako library
 */
function decompressGzip(compressedData: ArrayBuffer): string {
  const uint8Array = new Uint8Array(compressedData)

  console.log("[v0] Compressed data first 10 bytes:", Array.from(uint8Array.slice(0, 10)))
  console.log("[v0] Compressed data length:", uint8Array.length)

  try {
    // Try ungzip first (handles gzip wrapper)
    const decompressed = pako.inflate(uint8Array)
    console.log("[v0] Decompressed data length:", decompressed.length)
    console.log("[v0] Decompressed first 10 bytes:", Array.from(decompressed.slice(0, 10)))

    // Use TextDecoder for proper UTF-8 decoding
    const decoder = new TextDecoder("utf-8")
    const text = decoder.decode(decompressed)

    console.log("[v0] Decoded text length:", text.length)
    console.log("[v0] First 500 chars:", text.substring(0, 500))

    return text
  } catch (e) {
    console.error("[v0] Pako ungzip failed:", e)
    throw e
  }
}

/**
 * Load aircraft from CDN gzip file
 */
async function loadAircraftFromCDN(): Promise<AircraftData[]> {
  console.log("[Aircraft DB] Loading from CDN...")

  try {
    console.log("[Aircraft DB] Fetching:", AIRCRAFT_CDN_URL)

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
    console.log("[v0] Magic bytes:", uint8[0].toString(16), uint8[1].toString(16), "isGzipped:", isGzipped)

    let jsonText: string

    if (isGzipped) {
      console.log("[Aircraft DB] Data is gzipped, decompressing with pako...")
      jsonText = decompressGzip(arrayBuffer)
    } else {
      console.log("[Aircraft DB] Data is not gzipped, parsing directly...")
      const decoder = new TextDecoder("utf-8")
      jsonText = decoder.decode(arrayBuffer)
    }

    console.log("[Aircraft DB] JSON text length:", jsonText.length)
    console.log("[v0] JSON starts with:", jsonText.substring(0, 100))

    jsonText = jsonText.trim()
    if (jsonText.charCodeAt(0) === 0xfeff) {
      jsonText = jsonText.slice(1)
    }

    let data: unknown
    try {
      data = JSON.parse(jsonText)
    } catch (parseError) {
      console.error("[v0] JSON parse error at position:", (parseError as SyntaxError).message)
      // Log around potential error location
      const match = (parseError as SyntaxError).message.match(/position (\d+)/)
      if (match) {
        const pos = Number.parseInt(match[1], 10)
        console.error("[v0] JSON around error:", jsonText.substring(Math.max(0, pos - 50), pos + 50))
      }
      throw parseError
    }

    // Handle both array and object formats
    const aircraftArray = Array.isArray(data) ? data : Object.values(data)

    console.log("[Aircraft DB] Loaded", aircraftArray.length, "aircraft records")
    return aircraftArray as AircraftData[]
  } catch (error) {
    console.error("[Aircraft DB] Error loading from CDN:", error)
    throw error
  }
}

/**
 * Store aircraft data in IndexedDB for offline use
 */
async function storeInIndexedDB(aircraft: AircraftData[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)

    request.onerror = () => reject(request.error)

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "registration" })
        store.createIndex("typecode", "typecode", { unique: false })
        store.createIndex("manufacturer", "manufacturername", { unique: false })
        store.createIndex("icao24", "icao24", { unique: false })
      }
    }

    request.onsuccess = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      const transaction = db.transaction(STORE_NAME, "readwrite")
      const store = transaction.objectStore(STORE_NAME)

      // Clear existing data
      store.clear()

      // Add new data in batches
      let added = 0
      for (const ac of aircraft) {
        if (ac.registration) {
          store.put(ac)
          added++
        }
      }

      transaction.oncomplete = () => {
        console.log("[Aircraft DB] Stored", added, "aircraft in IndexedDB")
        localStorage.setItem(CACHE_VERSION_KEY, CACHE_VERSION)
        db.close()
        resolve()
      }

      transaction.onerror = () => {
        db.close()
        reject(transaction.error)
      }
    }
  })
}

/**
 * Load aircraft data from IndexedDB
 */
async function loadFromIndexedDB(): Promise<AircraftData[]> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)

    request.onerror = () => reject(request.error)

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "registration" })
      }
    }

    request.onsuccess = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      const transaction = db.transaction(STORE_NAME, "readonly")
      const store = transaction.objectStore(STORE_NAME)
      const getAllRequest = store.getAll()

      getAllRequest.onsuccess = () => {
        db.close()
        resolve(getAllRequest.result || [])
      }

      getAllRequest.onerror = () => {
        db.close()
        reject(getAllRequest.error)
      }
    }
  })
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
  if (aircraftCache) {
    return aircraftCache
  }

  // If already loading, wait for that promise
  if (loadingPromise) {
    return loadingPromise
  }

  loadingPromise = (async () => {
    try {
      // Try loading from IndexedDB first
      if (hasCachedData()) {
        console.log("[Aircraft DB] Loading from IndexedDB cache...")
        const cached = await loadFromIndexedDB()
        if (cached.length > 0) {
          aircraftCache = cached
          console.log("[Aircraft DB] Loaded", cached.length, "aircraft from cache")
          return cached
        }
      }

      // Load from CDN
      const aircraft = await loadAircraftFromCDN()

      // Store in IndexedDB for offline use
      await storeInIndexedDB(aircraft)

      aircraftCache = aircraft
      return aircraft
    } catch (error) {
      console.error("[Aircraft DB] Failed to initialize:", error)

      // Try loading from IndexedDB as fallback
      try {
        const cached = await loadFromIndexedDB()
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

  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}
