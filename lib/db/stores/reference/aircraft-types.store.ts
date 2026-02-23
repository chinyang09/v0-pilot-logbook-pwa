/**
 * Aircraft types store operations (reference data)
 *
 * Loads and caches ICAO DOC 8643 aircraft type designators
 * from public/icao-types.min.json
 */

import { referenceDb } from "../../reference-db"
import type { AircraftTypeRaw, AircraftType } from "@/types/entities/aircraft-type.types"
import { expandAircraftType } from "@/lib/utils/aircraft-type-utils"

// ============================================
// Configuration
// ============================================

const AIRCRAFT_TYPES_URL = "/icao-types.min.json"
const CACHE_VERSION_KEY = "aircraft-types-version"
const CACHE_VERSION = "2026.02.22-v1"

// ============================================
// State
// ============================================

let typesCache: AircraftTypeRaw[] | null = null
let loadingPromise: Promise<AircraftTypeRaw[]> | null = null

// ============================================
// Data Loading
// ============================================

/**
 * Load aircraft types from public JSON, cache in IndexedDB
 */
export async function loadAircraftTypes(): Promise<AircraftTypeRaw[]> {
  // Return from memory cache
  if (typesCache && typesCache.length > 0) {
    return typesCache
  }

  // Deduplicate concurrent loads
  if (loadingPromise) {
    return loadingPromise
  }

  loadingPromise = (async () => {
    try {
      // Check IndexedDB cache
      const storedVersion = await referenceDb.getMetadata(CACHE_VERSION_KEY)
      if (storedVersion === CACHE_VERSION) {
        const count = await referenceDb.aircraftTypes.count()
        if (count > 0) {
          typesCache = await referenceDb.aircraftTypes.toArray()
          return typesCache
        }
      }

      // Fetch from public file
      console.log("[Aircraft Types] Loading from public file...")
      const response = await fetch(AIRCRAFT_TYPES_URL)
      if (!response.ok) {
        throw new Error(`Failed to fetch aircraft types: ${response.status}`)
      }

      const types: AircraftTypeRaw[] = await response.json()

      // Store in IndexedDB
      await referenceDb.transaction("rw", referenceDb.aircraftTypes, referenceDb.metadata, async () => {
        await referenceDb.aircraftTypes.clear()
        await referenceDb.aircraftTypes.bulkPut(types)
        await referenceDb.setMetadata(CACHE_VERSION_KEY, CACHE_VERSION)
      })

      typesCache = types
      console.log(`[Aircraft Types] Loaded ${types.length} types`)
      return types
    } catch (error) {
      console.error("[Aircraft Types] Failed to load:", error)
      // Try to return whatever is in IndexedDB
      const cached = await referenceDb.aircraftTypes.toArray()
      if (cached.length > 0) {
        typesCache = cached
        return cached
      }
      return []
    } finally {
      loadingPromise = null
    }
  })()

  return loadingPromise
}

// ============================================
// Public API - Lookup
// ============================================

/**
 * Get a single aircraft type by ICAO designator
 */
export async function getAircraftType(designator: string): Promise<AircraftType | null> {
  if (!designator) return null

  const code = designator.toUpperCase().trim()

  // Try memory cache first
  if (typesCache) {
    const raw = typesCache.find((t) => t.d === code)
    return raw ? expandAircraftType(raw) : null
  }

  // Try IndexedDB
  const raw = await referenceDb.aircraftTypes.get(code)
  return raw ? expandAircraftType(raw) : null
}

/**
 * Get a raw aircraft type by ICAO designator (no expansion)
 */
export async function getAircraftTypeRaw(designator: string): Promise<AircraftTypeRaw | null> {
  if (!designator) return null

  const code = designator.toUpperCase().trim()

  if (typesCache) {
    return typesCache.find((t) => t.d === code) || null
  }

  const raw = await referenceDb.aircraftTypes.get(code)
  return raw || null
}

// ============================================
// Public API - Search
// ============================================

/**
 * Search aircraft types by designator or manufacturer
 */
export async function searchAircraftTypes(query: string, limit = 50): Promise<AircraftType[]> {
  if (!query || query.length < 1) return []

  const types = await loadAircraftTypes()
  const q = query.toUpperCase().trim()

  const matches: Array<{ raw: AircraftTypeRaw; score: number }> = []

  for (const raw of types) {
    let score = 0
    const designator = raw.d.toUpperCase()
    const manufacturer = raw.m.toUpperCase()

    if (designator === q) {
      score = 1000
    } else if (designator.startsWith(q)) {
      score = 900
    } else if (manufacturer === q) {
      score = 800
    } else if (manufacturer.startsWith(q)) {
      score = 700
    } else if (manufacturer.includes(q)) {
      score = 300
    }

    if (score > 0) {
      matches.push({ raw, score })
    }
  }

  matches.sort((a, b) => b.score - a.score)
  return matches.slice(0, limit).map((m) => expandAircraftType(m.raw))
}

/**
 * Get all aircraft types (expanded)
 */
export async function getAllAircraftTypes(): Promise<AircraftType[]> {
  const types = await loadAircraftTypes()
  return types.map(expandAircraftType)
}

/**
 * Clear the aircraft types cache
 */
export async function clearAircraftTypesCache(): Promise<void> {
  typesCache = null
  loadingPromise = null
  await referenceDb.aircraftTypes.clear()
}
