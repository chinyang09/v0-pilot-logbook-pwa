import { userDb as db } from "@/lib/db"

export interface AircraftData {
  icao24: string
  reg: string | null
  icaotype: string | null
  short_type: string | null
}

export interface NormalizedAircraft {
  registration: string
  icao24: string
  typecode: string
  shortType: string
}

const AIRCRAFT_CDN_URL =
  "https://cdn.jsdelivr.net/gh/chinyang09/Aircraft-Database@v2025.12.02/data/aircraft-slim.json.gz"
const METADATA_URL = "https://cdn.jsdelivr.net/gh/chinyang09/Aircraft-Database@v2025.12.02/data/metadata.json"
const CACHE_VERSION_KEY = "aircraft-database-version"
const CACHE_VERSION = "2025.12.02-slim-v5"
const CACHE_ETAG_KEY = "aircraft-database-etag"

interface AircraftMetadata {
  dataset: string
  version: string
  generatedAt: string
  source: string
  format: string
  records: number
  file: string
  sha256: string
}

let metadata: AircraftMetadata | null = null

type ProgressCallback = (progress: { stage: string; percent: number; count?: number }) => void
let progressCallback: ProgressCallback | null = null

export function setProgressCallback(cb: ProgressCallback | null): void {
  progressCallback = cb
}

function reportProgress(stage: string, percent: number, count?: number): void {
  if (progressCallback) {
    progressCallback({ stage, percent, count })
  }
}

const searchCache = new Map<string, { results: NormalizedAircraft[]; timestamp: number }>()
const SEARCH_CACHE_TTL = 60000 // 1 minute
const SEARCH_CACHE_MAX_SIZE = 50

function normalizeForSearch(str: string): string {
  return str.toUpperCase().replace(/-/g, "")
}

function getCachedSearch(query: string): NormalizedAircraft[] | null {
  const normalizedQuery = normalizeForSearch(query)
  const cached = searchCache.get(normalizedQuery)
  if (cached && Date.now() - cached.timestamp < SEARCH_CACHE_TTL) {
    return cached.results
  }
  searchCache.delete(normalizedQuery)
  return null
}

function setCachedSearch(query: string, results: NormalizedAircraft[]): void {
  const normalizedQuery = normalizeForSearch(query)
  // Evict oldest entries if cache is full
  if (searchCache.size >= SEARCH_CACHE_MAX_SIZE) {
    const oldest = [...searchCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)[0]
    if (oldest) searchCache.delete(oldest[0])
  }
  searchCache.set(normalizedQuery, { results, timestamp: Date.now() })
}

async function loadMetadata(): Promise<AircraftMetadata | null> {
  try {
    const response = await fetch(METADATA_URL, { cache: "default" })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

async function decompressGzip(compressedData: ArrayBuffer): Promise<string> {
  const uint8Array = new Uint8Array(compressedData)

  // Verify gzip magic bytes (0x1f 0x8b)
  if (uint8Array[0] !== 0x1f || uint8Array[1] !== 0x8b) {
    const decoder = new TextDecoder("utf-8")
    return decoder.decode(uint8Array)
  }

  // Try native DecompressionStream first (faster, no library needed)
  if (typeof DecompressionStream !== "undefined") {
    try {
      const stream = new Blob([compressedData]).stream()
      const decompressedStream = stream.pipeThrough(new DecompressionStream("gzip"))
      const decompressedBlob = await new Response(decompressedStream).blob()
      return await decompressedBlob.text()
    } catch {
      // Fall through to pako
    }
  }

  // Fallback to pako
  const pako = await import("pako")
  const decompressed = pako.ungzip(uint8Array)
  const decoder = new TextDecoder("utf-8")
  return decoder.decode(decompressed)
}

async function shouldRedownload(): Promise<boolean> {
  const cachedVersion = localStorage.getItem(CACHE_VERSION_KEY)
  if (cachedVersion !== CACHE_VERSION) return true

  const count = await getCachedCount()
  if (count < 500000) return true

  // Check ETag for updates
  try {
    const cachedEtag = localStorage.getItem(CACHE_ETAG_KEY)
    if (!cachedEtag) return false // Already have data, don't redownload without ETag

    const response = await fetch(AIRCRAFT_CDN_URL, { method: "HEAD" })
    const newEtag = response.headers.get("etag")
    return newEtag !== cachedEtag
  } catch {
    return false // Network error, use cached data
  }
}

async function loadAndStoreAircraftFromCDN(): Promise<number> {
  reportProgress("Checking metadata", 0)
  metadata = await loadMetadata()

  reportProgress("Downloading", 5)
  const response = await fetch(AIRCRAFT_CDN_URL, { cache: "default" })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  // Save ETag for future checks
  const etag = response.headers.get("etag")
  if (etag) {
    localStorage.setItem(CACHE_ETAG_KEY, etag)
  }

  reportProgress("Downloading", 20)
  const arrayBuffer = await response.arrayBuffer()

  reportProgress("Decompressing", 30)
  const ndjsonText = await decompressGzip(arrayBuffer)

  reportProgress("Parsing", 40)

  const allRecords: { registration: string; data: string }[] = []
  let parsed = 0
  let start = 0
  const totalLength = ndjsonText.length
  const estimatedRecords = 615656

  while (start < totalLength) {
    let end = ndjsonText.indexOf("\n", start)
    if (end === -1) end = totalLength

    const line = ndjsonText.substring(start, end).trim()
    start = end + 1

    if (!line) continue

    try {
      const obj = JSON.parse(line) as AircraftData
      if (obj && obj.icao24) {
        allRecords.push({
          registration: obj.icao24.toUpperCase(),
          data: line, // Store original JSON string to avoid re-stringify
        })
        parsed++

        // Report progress every 50k records
        if (parsed % 50000 === 0) {
          reportProgress("Parsing", 40 + Math.round((parsed / estimatedRecords) * 20), parsed)
          // Yield to UI
          await new Promise((resolve) => setTimeout(resolve, 0))
        }
      }
    } catch {
      // Skip invalid lines
    }
  }

  reportProgress("Storing", 60)

  await db.transaction("rw", db.aircraftDatabase, async () => {
    await db.aircraftDatabase.clear()

    const batchSize = 25000 // Increased batch size
    for (let i = 0; i < allRecords.length; i += batchSize) {
      const batch = allRecords.slice(i, i + batchSize)
      await db.aircraftDatabase.bulkPut(batch)

      const progress = 60 + Math.round(((i + batch.length) / allRecords.length) * 35)
      reportProgress("Storing", progress, i + batch.length)
    }
  })

  localStorage.setItem(CACHE_VERSION_KEY, CACHE_VERSION)
  reportProgress("Complete", 100, allRecords.length)

  // Clear search cache when data is updated
  searchCache.clear()

  return allRecords.length
}

async function getCachedCount(): Promise<number> {
  try {
    return await db.aircraftDatabase.count()
  } catch {
    return 0
  }
}

function hasCachedData(): boolean {
  return localStorage.getItem(CACHE_VERSION_KEY) === CACHE_VERSION
}

let loadingPromise: Promise<boolean> | null = null
let isInitializing = false
let isReady = false

export async function quickInit(): Promise<boolean> {
  if (isReady) return true

  if (hasCachedData()) {
    const count = await getCachedCount()
    if (count > 500000) {
      isReady = true
      return true
    }
  }
  return false
}

export async function initializeAircraftDatabase(): Promise<boolean> {
  if (isReady) return true

  if (loadingPromise) {
    return loadingPromise
  }

  loadingPromise = (async () => {
    try {
      const needsDownload = await shouldRedownload()

      if (needsDownload && !isInitializing) {
        isInitializing = true
        await loadAndStoreAircraftFromCDN()
        isInitializing = false
      }

      isReady = true
      return true
    } catch (error) {
      console.error("[Aircraft DB] Failed to initialize:", error)
      isInitializing = false

      // Check if we have cached data to fall back to
      const count = await getCachedCount()
      if (count > 500000) {
        isReady = true
        return true
      }
      return false
    } finally {
      loadingPromise = null
    }
  })()

  return loadingPromise
}

export async function searchAircraftFromDB(query: string, limit = 50): Promise<NormalizedAircraft[]> {
  if (!query || query.length < 2) return []

  const q = query.toUpperCase().trim()
  const qNormalized = normalizeForSearch(q)

  // Check cache first
  const cached = getCachedSearch(q)
  if (cached) return cached

  const matches: Array<{ aircraft: AircraftData; score: number }> = []

  // Use IndexedDB cursor for memory-efficient search
  await db.aircraftDatabase
    .where("registration")
    .startsWithIgnoreCase(qNormalized.charAt(0))
    .until(() => matches.length >= limit * 3)
    .each((record) => {
      try {
        const ac = JSON.parse(record.data) as AircraftData
        let score = 0
        const reg = (ac.reg || "").toUpperCase()
        const icaotype = (ac.icaotype || "").toUpperCase()
        const icao24 = (ac.icao24 || "").toUpperCase()
        const shortType = (ac.short_type || "").toUpperCase()

        const regNormalized = normalizeForSearch(reg)

        if (regNormalized && regNormalized === qNormalized) {
          score = 1000
        } else if (regNormalized && regNormalized.startsWith(qNormalized)) {
          score = 900
        } else if (regNormalized && regNormalized.includes(qNormalized)) {
          score = 800
        } else if (icaotype === q) {
          score = 700
        } else if (icaotype && icaotype.startsWith(q)) {
          score = 600
        } else if (icao24 === q) {
          score = 550
        } else if (icao24 && icao24.startsWith(q)) {
          score = 500
        } else if (shortType === q || (shortType && shortType.includes(q))) {
          score = 400
        }

        if (score > 0) {
          matches.push({ aircraft: ac, score })
        }
      } catch {
        // Skip invalid records
      }
    })

  matches.sort((a, b) => b.score - a.score)
  const results = matches.slice(0, limit).map((m) => normalizeAircraft(m.aircraft))

  // Cache results
  setCachedSearch(q, results)

  return results
}

export async function getAircraftByRegistrationFromDB(registration: string): Promise<NormalizedAircraft | undefined> {
  const reg = registration.toUpperCase()
  const regNormalized = normalizeForSearch(reg)

  // Try exact ICAO24 match first (primary key)
  let record = await db.aircraftDatabase.get(reg)

  if (!record) {
    // Search by registration field (dash-insensitive)
    await db.aircraftDatabase
      .filter((r) => {
        try {
          const ac = JSON.parse(r.data) as AircraftData
          return normalizeForSearch(ac.reg || "") === regNormalized
        } catch {
          return false
        }
      })
      .first()
      .then((r) => {
        record = r
      })
  }

  if (!record) return undefined

  try {
    const ac = JSON.parse(record.data) as AircraftData
    return normalizeAircraft(ac)
  } catch {
    return undefined
  }
}

export async function getAircraftByIcao24FromDB(icao24: string): Promise<NormalizedAircraft | undefined> {
  const record = await db.aircraftDatabase.get(icao24.toUpperCase())
  if (!record) return undefined

  try {
    const ac = JSON.parse(record.data) as AircraftData
    return normalizeAircraft(ac)
  } catch {
    return undefined
  }
}

export function normalizeAircraft(aircraft: AircraftData): NormalizedAircraft {
  return {
    registration: aircraft.reg || "",
    icao24: aircraft.icao24 || "",
    typecode: aircraft.icaotype || "",
    shortType: aircraft.short_type || "",
  }
}

export function formatAircraft(aircraft: NormalizedAircraft): string {
  const parts = [aircraft.registration]
  if (aircraft.typecode) parts.push(`(${aircraft.typecode})`)
  return parts.join(" ")
}

export function isAircraftDatabaseReady(): boolean {
  return isReady
}

export function getAircraftMetadata(): AircraftMetadata | null {
  return metadata
}

export async function clearAircraftCache(): Promise<void> {
  isReady = false
  metadata = null
  searchCache.clear()
  localStorage.removeItem(CACHE_VERSION_KEY)
  localStorage.removeItem(CACHE_ETAG_KEY)
  await db.aircraftDatabase.clear()
}

// ============================================
// LEGACY API - kept for backward compatibility
// These functions now use the optimized DB-based methods
// ============================================

let aircraftCache: AircraftData[] | null = null

// @deprecated - Use searchAircraftFromDB instead
export async function getAircraftDatabase(): Promise<AircraftData[]> {
  // For backward compatibility, load into memory if needed
  if (aircraftCache && aircraftCache.length > 0) {
    return aircraftCache
  }

  await initializeAircraftDatabase()

  // Load from DB into memory (legacy behavior)
  reportProgress("Loading from cache", 0)
  const records = await db.aircraftDatabase.toArray()

  aircraftCache = records
    .map((r) => {
      try {
        return JSON.parse(r.data) as AircraftData
      } catch {
        return null
      }
    })
    .filter((a): a is AircraftData => a !== null)

  reportProgress("Ready", 100, aircraftCache.length)
  return aircraftCache
}

// @deprecated - Use searchAircraftFromDB instead
export function searchAircraft(aircraft: AircraftData[], query: string, limit = 50): NormalizedAircraft[] {
  if (!query || query.length < 2) return []

  const q = query.toUpperCase().trim()
  const qNormalized = normalizeForSearch(q)
  const matches: Array<{ aircraft: AircraftData; score: number }> = []

  for (const ac of aircraft) {
    let score = 0
    const reg = (ac.reg || "").toUpperCase()
    const icaotype = (ac.icaotype || "").toUpperCase()
    const icao24 = (ac.icao24 || "").toUpperCase()
    const shortType = (ac.short_type || "").toUpperCase()

    const regNormalized = normalizeForSearch(reg)

    if (regNormalized && regNormalized === qNormalized) {
      score = 1000
    } else if (regNormalized && regNormalized.startsWith(qNormalized)) {
      score = 900
    } else if (regNormalized && regNormalized.includes(qNormalized)) {
      score = 800
    } else if (icaotype === q) {
      score = 700
    } else if (icaotype && icaotype.startsWith(q)) {
      score = 600
    } else if (icao24 === q) {
      score = 550
    } else if (icao24 && icao24.startsWith(q)) {
      score = 500
    } else if (shortType === q || (shortType && shortType.includes(q))) {
      score = 400
    }

    if (score > 0) {
      matches.push({ aircraft: ac, score })
    }

    if (matches.length > limit * 3) {
      break
    }
  }

  matches.sort((a, b) => b.score - a.score)
  return matches.slice(0, limit).map((m) => normalizeAircraft(m.aircraft))
}

// @deprecated - Use getAircraftByRegistrationFromDB instead
export function getAircraftByRegistration(
  aircraft: AircraftData[],
  registration: string,
): NormalizedAircraft | undefined {
  const reg = registration.toUpperCase()
  const regNormalized = normalizeForSearch(reg)
  const found = aircraft.find((ac) => normalizeForSearch(ac.reg || "") === regNormalized)
  return found ? normalizeAircraft(found) : undefined
}

// @deprecated - Use getAircraftByIcao24FromDB instead
export function getAircraftByIcao24(aircraft: AircraftData[], icao24: string): NormalizedAircraft | undefined {
  const found = aircraft.find((ac) => ac.icao24?.toUpperCase() === icao24.toUpperCase())
  return found ? normalizeAircraft(found) : undefined
}

export function isAircraftDatabaseLoaded(): boolean {
  return isReady || (aircraftCache !== null && aircraftCache.length > 0)
}

export async function loadIntoMemory(): Promise<number> {
  const aircraft = await getAircraftDatabase()
  return aircraft.length
}
