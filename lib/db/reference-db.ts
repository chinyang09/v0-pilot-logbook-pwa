/**
 * Reference database (persists across sessions)
 *
 * Contains read-only reference data that doesn't sync:
 * - Airports (from CDN/public JSON)
 * - Aircraft database (CDN aircraft lookup cache)
 * - Metadata (version info, cache timestamps)
 */

import Dexie, { type Table } from "dexie"
import type { Airport } from "@/types/entities/airport.types"
import type { AircraftReference } from "@/types/entities/aircraft.types"

interface ReferenceMetadata {
  key: string
  value: any
  updatedAt: number
}

class ReferenceDatabase extends Dexie {
  airports!: Table<Airport, string>
  aircraftDatabase!: Table<AircraftReference, string>
  metadata!: Table<ReferenceMetadata, string>

  constructor() {
    super("PilotLogbook_Reference")

    this.version(1).stores({
      airports: "icao, iata, name, id, isFavorite",
      aircraftDatabase: "registration",
      metadata: "key",
    })
  }

  /**
   * Get metadata value by key
   */
  async getMetadata(key: string): Promise<any> {
    const record = await this.metadata.get(key)
    return record?.value
  }

  /**
   * Set metadata value
   */
  async setMetadata(key: string, value: any): Promise<void> {
    await this.metadata.put({
      key,
      value,
      updatedAt: Date.now(),
    })
  }

  /**
   * Check if airports need to be reloaded
   */
  async shouldReloadAirports(currentVersion: string): Promise<boolean> {
    const storedVersion = await this.getMetadata("airport_version")
    return storedVersion !== currentVersion
  }
}

export const referenceDb = new ReferenceDatabase()

/**
 * Initialize the reference database
 */
export async function initializeReferenceDB(): Promise<boolean> {
  try {
    const openPromise = referenceDb.open()
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Reference database open timeout")), 10000)
    )

    await Promise.race([openPromise, timeoutPromise])
    console.log("[ReferenceDB] Database initialized successfully")
    return true
  } catch (error) {
    console.error("[ReferenceDB] Failed to initialize:", error)
    return false
  }
}
