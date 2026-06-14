/**
 * Aircraft flight reconciliation
 *
 * When aircraft data is enriched (canonical registration, typecode),
 * find all flights referencing that aircraft and update them.
 *
 * Client-side only — uses Dexie (IndexedDB) directly.
 */

import { userDb } from "@/lib/db/user-db"
import { updateFlight } from "@/lib/db/stores/user/flights.store"
import { normalizeRegistration as normalizeReg } from "@/lib/utils/string"
import type { FlightLog } from "@/types/entities/flight.types"

/**
 * Reconcile flights when aircraft enrichment data arrives.
 *
 * Matches flights by normalized registration (case-insensitive, strip dashes/special chars).
 * Updates:
 *   - aircraftReg → canonical form (e.g., "9vtnk" → "9V-TNK")
 *   - aircraftType → enriched typecode (only if currently empty)
 *
 * Returns the number of flights updated.
 */
export async function reconcileFlightsForAircraft(
  originalReg: string,
  enrichedData: {
    registration: string
    typecode: string
  }
): Promise<number> {
  const normalizedOriginal = normalizeReg(originalReg)
  const normalizedEnriched = normalizeReg(enrichedData.registration)

  // Find all flights where aircraftReg matches (normalized)
  const allFlights = await userDb.flights.toArray()
  const matchingFlights = allFlights.filter((f) => {
    const normalizedFlight = normalizeReg(f.aircraftReg)
    return normalizedFlight === normalizedOriginal || normalizedFlight === normalizedEnriched
  })

  if (matchingFlights.length === 0) return 0

  let updatedCount = 0
  for (const flight of matchingFlights) {
    const updates: Partial<FlightLog> = {}
    let hasChanges = false

    // Update registration to canonical form
    if (flight.aircraftReg !== enrichedData.registration) {
      updates.aircraftReg = enrichedData.registration
      hasChanges = true
    }

    // Update typecode only if currently empty
    if (!flight.aircraftType && enrichedData.typecode) {
      updates.aircraftType = enrichedData.typecode
      hasChanges = true
    }

    if (hasChanges) {
      await updateFlight(flight.id, updates)
      updatedCount++
    }
  }

  if (updatedCount > 0) {
    console.log(
      `[Reconciliation] Updated ${updatedCount} flights for aircraft ${enrichedData.registration}`
    )
  }

  return updatedCount
}
