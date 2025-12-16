// and fixing registration key issue for aircraft with null registrations

import { db } from "./indexed-db"

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
const CACHE_VERSION = "2025.12.02-slim-v4"

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

  // Dynamic import pako
  const pako = await import("pako")
  const decompressed = pako.ungzip(uint8Array)
  const decoder = new TextDecoder("utf-8")
  return decoder.decode(decompressed)
}

function* parseNDJSONChunked(text: string, chunkSize = 10000): Generator<AircraftData[]> {
  const lines = text.split("\n")
  let batch: AircraftData[] = []
  let totalParsed = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    try {
      const obj = JSON.parse(line) as AircraftData
      if (obj && obj.icao24) {
        batch.push(obj)
        totalParsed++
      }
    } catch {
      // Skip invalid lines
    }

    if (batch.length >= chunkSize) {
      yield batch
      reportProgress("Parsing", Math.round((i / lines.length) * 100), totalParsed)
      batch = []
    }
  }

  if (batch.length > 0) {
    yield batch
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

  reportProgress("Downloading", 20)
  const arrayBuffer = await response.arrayBuffer()

  reportProgress("Decompressing", 30)
  const ndjsonText = await decompressGzip(arrayBuffer)

  await db.aircraftDatabase.clear()

  reportProgress("Parsing", 40)
  let totalStored = 0

  for (const batch of parseNDJSONChunked(ndjsonText, 10000)) {
    const records = batch
      .filter((ac) => ac.icao24)
      .map((ac) => ({
        registration: ac.icao24.toUpperCase(), // Use icao24 as the key
        data: JSON.stringify(ac),
      }))

    await db.aircraftDatabase.bulkPut(records)
    totalStored += records.length

    reportProgress("Storing", 40 + Math.round((totalStored / 615656) * 55), totalStored)

    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  localStorage.setItem(CACHE_VERSION_KEY, CACHE_VERSION)
  reportProgress("Complete", 100, totalStored)

  return totalStored
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

let aircraftCache: AircraftData[] | null = null
let loadingPromise: Promise<AircraftData[]> | null = null
let isInitializing = false

export async function quickInit(): Promise<boolean> {
  if (aircraftCache && aircraftCache.length > 0) return true

  if (hasCachedData()) {
    const count = await getCachedCount()
    if (count > 500000) {
      return true
    }
  }
  return false
}

export async function loadIntoMemory(): Promise<number> {
  if (aircraftCache && aircraftCache.length > 0) {
    return aircraftCache.length
  }

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
  return aircraftCache.length
}

export async function getAircraftDatabase(): Promise<AircraftData[]> {
  if (aircraftCache && aircraftCache.length > 0) {
    return aircraftCache
  }

  if (loadingPromise) {
    return loadingPromise
  }

  loadingPromise = (async () => {
    try {
      if (hasCachedData()) {
        const count = await getCachedCount()
        if (count > 500000) {
          await loadIntoMemory()
          if (aircraftCache && aircraftCache.length > 0) {
            return aircraftCache
          }
        }
      }

      if (!isInitializing) {
        isInitializing = true
        await loadAndStoreAircraftFromCDN()
        await loadIntoMemory()
        isInitializing = false
      }

      return aircraftCache || []
    } catch (error) {
      console.error("[Aircraft DB] Failed to initialize:", error)
      isInitializing = false

      try {
        await loadIntoMemory()
        return aircraftCache || []
      } catch {
        return []
      }
    } finally {
      loadingPromise = null
    }
  })()

  return loadingPromise
}

export function normalizeAircraft(aircraft: AircraftData): NormalizedAircraft {
  return {
    registration: aircraft.reg || "",
    icao24: aircraft.icao24 || "",
    typecode: aircraft.icaotype || "",
    shortType: aircraft.short_type || "",
  }
}

export function searchAircraft(aircraft: AircraftData[], query: string, limit = 50): NormalizedAircraft[] {
  if (!query || query.length < 2) return []

  const q = query.toUpperCase().trim()
  const matches: Array<{ aircraft: AircraftData; score: number }> = []

  for (const ac of aircraft) {
    let score = 0
    const reg = (ac.reg || "").toUpperCase()
    const icaotype = (ac.icaotype || "").toUpperCase()
    const icao24 = (ac.icao24 || "").toUpperCase()
    const shortType = (ac.short_type || "").toUpperCase()

    if (reg && reg === q) {
      score = 1000
    } else if (reg && reg.startsWith(q)) {
      score = 900
    } else if (reg && reg.includes(q)) {
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

export function getAircraftByRegistration(
  aircraft: AircraftData[],
  registration: string,
): NormalizedAircraft | undefined {
  const reg = registration.toUpperCase()
  const found = aircraft.find((ac) => ac.reg?.toUpperCase() === reg)
  return found ? normalizeAircraft(found) : undefined
}

export function getAircraftByIcao24(aircraft: AircraftData[], icao24: string): NormalizedAircraft | undefined {
  const found = aircraft.find((ac) => ac.icao24?.toUpperCase() === icao24.toUpperCase())
  return found ? normalizeAircraft(found) : undefined
}

export function formatAircraft(aircraft: NormalizedAircraft): string {
  const parts = [aircraft.registration]
  if (aircraft.typecode) parts.push(`(${aircraft.typecode})`)
  return parts.join(" ")
}

export function isAircraftDatabaseLoaded(): boolean {
  return aircraftCache !== null && aircraftCache.length > 0
}

export function getAircraftMetadata(): AircraftMetadata | null {
  return metadata
}

export async function clearAircraftCache(): Promise<void> {
  aircraftCache = null
  metadata = null
  localStorage.removeItem(CACHE_VERSION_KEY)
  await db.aircraftDatabase.clear()
}
