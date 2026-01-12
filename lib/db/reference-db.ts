/**
 * Reference Database - Dexie/IndexedDB
 * Contains reference data (airports, aircraft cache from CDN)
 * PERSISTS ACROSS SESSIONS - never cleared on logout
 */

import Dexie, { type Table } from "dexie"
import type { Airport } from "@/types/entities/airport.types"
import type { AircraftCacheEntry, RefMetadata } from "@/types/infrastructure/db.types"

class ReferenceDatabase extends Dexie {
  airports!: Table<Airport, string> // Keyed by ICAO
  aircraftCache!: Table<AircraftCacheEntry, string> // CDN aircraft data cache
  metadata!: Table<RefMetadata, string>

  constructor() {
    super("PilotLogbook_Reference")

    this.version(1).stores({
      airports: "icao, iata, name, city, country, id, isFavorite",
      aircraftCache: "registration", // registration is icao24 hex
      metadata: "key",
    })
  }
}

export const referenceDb = new ReferenceDatabase()

/**
 * Initialize reference database
 */
export async function initializeReferenceDb(): Promise<boolean> {
  try {
    const openPromise = referenceDb.open()
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("ReferenceDB open timeout")), 10000),
    )
    await Promise.race([openPromise, timeoutPromise])
    console.log("[ReferenceDB] Initialized successfully")
    return true
  } catch (error) {
    console.error("[ReferenceDB] Failed to initialize:", error)
    return false
  }
}
