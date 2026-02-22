/**
 * Airport flight reconciliation
 *
 * When airport data is enriched (lat/lon, timezone, IATA),
 * find all flights referencing that airport and recalculate derived fields.
 *
 * Client-side only — uses Dexie (IndexedDB) directly.
 */

import { userDb } from "@/lib/db/user-db"
import { updateFlight } from "@/lib/db/stores/user/flights.store"
import { getAirportByIcao } from "@/lib/db/stores/reference/airports.store"
import { getAirportTimeInfo } from "@/lib/db/stores/reference/airports.store"
import { recalculateFlightFields } from "@/lib/utils/flight-calculations"
import type { FlightLog } from "@/types/entities/flight.types"
import type { Airport } from "@/types/entities/airport.types"

/**
 * Reconcile flights when airport enrichment data arrives.
 *
 * Matches flights by departure or arrival ICAO code.
 * Updates:
 *   - departureIata / arrivalIata (if enriched)
 *   - departureTimezone / arrivalTimezone (from IANA timezone)
 *   - nightTime, dayTime, day/night takeoffs/landings (recalculated with airport lat/lon)
 *
 * Respects manualOverrides — recalculateFlightFields() handles this automatically.
 *
 * Returns the number of flights updated.
 */
export async function reconcileFlightsForAirport(
  icao: string,
  enrichedData: {
    latitude: number
    longitude: number
    timezone: string
    iata?: string
  }
): Promise<number> {
  const icaoUpper = icao.toUpperCase()

  // Find all flights referencing this airport
  const allFlights = await userDb.flights.toArray()
  const matchingFlights = allFlights.filter(
    (f) => f.departureIcao === icaoUpper || f.arrivalIcao === icaoUpper
  )

  if (matchingFlights.length === 0) return 0

  // Build a virtual airport object from enriched data for recalculation
  const enrichedAirport: Airport = {
    id: 0,
    icao: icaoUpper,
    iata: enrichedData.iata || "",
    name: "",
    city: "",
    state: "",
    country: "",
    latitude: enrichedData.latitude,
    longitude: enrichedData.longitude,
    elevation: 0,
    tz: enrichedData.timezone,
  }

  // Get timezone offset from IANA timezone string
  const tzInfo = enrichedData.timezone
    ? getAirportTimeInfo(enrichedData.timezone)
    : null

  let updatedCount = 0
  for (const flight of matchingFlights) {
    const updates: Partial<FlightLog> = {}
    let hasChanges = false

    const isDep = flight.departureIcao === icaoUpper
    const isArr = flight.arrivalIcao === icaoUpper

    // Update IATA code if enriched and currently empty
    if (enrichedData.iata) {
      if (isDep && !flight.departureIata) {
        updates.departureIata = enrichedData.iata
        hasChanges = true
      }
      if (isArr && !flight.arrivalIata) {
        updates.arrivalIata = enrichedData.iata
        hasChanges = true
      }
    }

    // Update timezone offset
    if (tzInfo) {
      if (isDep && flight.departureTimezone === 0 && tzInfo.offset !== 0) {
        updates.departureTimezone = tzInfo.offset
        hasChanges = true
      }
      if (isArr && flight.arrivalTimezone === 0 && tzInfo.offset !== 0) {
        updates.arrivalTimezone = tzInfo.offset
        hasChanges = true
      }
    }

    // Recalculate night time, takeoffs/landings with correct airport coordinates
    if (enrichedData.latitude !== 0 && enrichedData.longitude !== 0) {
      const depAirport = isDep
        ? enrichedAirport
        : await getAirportByIcao(flight.departureIcao) ?? null
      const arrAirport = isArr
        ? enrichedAirport
        : await getAirportByIcao(flight.arrivalIcao) ?? null

      if (depAirport && arrAirport) {
        const recalculated = recalculateFlightFields(flight, depAirport, arrAirport)

        // Merge recalculated values (respects manualOverrides)
        if (recalculated.nightTime !== undefined && recalculated.nightTime !== flight.nightTime) {
          updates.nightTime = recalculated.nightTime
          hasChanges = true
        }
        if (recalculated.dayTime !== undefined && recalculated.dayTime !== flight.dayTime) {
          updates.dayTime = recalculated.dayTime
          hasChanges = true
        }
        if (recalculated.dayTakeoffs !== undefined && recalculated.dayTakeoffs !== flight.dayTakeoffs) {
          updates.dayTakeoffs = recalculated.dayTakeoffs
          hasChanges = true
        }
        if (recalculated.nightTakeoffs !== undefined && recalculated.nightTakeoffs !== flight.nightTakeoffs) {
          updates.nightTakeoffs = recalculated.nightTakeoffs
          hasChanges = true
        }
        if (recalculated.dayLandings !== undefined && recalculated.dayLandings !== flight.dayLandings) {
          updates.dayLandings = recalculated.dayLandings
          hasChanges = true
        }
        if (recalculated.nightLandings !== undefined && recalculated.nightLandings !== flight.nightLandings) {
          updates.nightLandings = recalculated.nightLandings
          hasChanges = true
        }
      }
    }

    if (hasChanges) {
      await updateFlight(flight.id, updates)
      updatedCount++
    }
  }

  if (updatedCount > 0) {
    console.log(
      `[Reconciliation] Updated ${updatedCount} flights for airport ${icaoUpper}`
    )
  }

  return updatedCount
}
