/**
 * Data hooks exports
 */

export { useDBReady } from "./use-db-ready"
export { useFlights, FLIGHTS_CACHE_KEY } from "./use-flights"
export { usePersonnel, useCrew, PERSONNEL_CACHE_KEY } from "./use-crew"
export { useAircraft, AIRCRAFT_CACHE_KEY } from "./use-aircraft"
export { useAirports, useAirportDatabase, AIRPORTS_CACHE_KEY } from "./use-airports"
export { useFlightStats, STATS_CACHE_KEY } from "./use-stats"

// Re-export mutate for refreshing all data
import { mutate } from "swr"
import { FLIGHTS_CACHE_KEY } from "./use-flights"
import { PERSONNEL_CACHE_KEY } from "./use-crew"
import { AIRCRAFT_CACHE_KEY } from "./use-aircraft"
import { STATS_CACHE_KEY } from "./use-stats"

export async function refreshAllData() {
  console.log("[v0] Refreshing all data from IndexedDB...")
  await Promise.all([
    mutate(FLIGHTS_CACHE_KEY, undefined, { revalidate: true }),
    mutate(AIRCRAFT_CACHE_KEY, undefined, { revalidate: true }),
    mutate(PERSONNEL_CACHE_KEY, undefined, { revalidate: true }),
    mutate(STATS_CACHE_KEY, undefined, { revalidate: true }),
  ])
  console.log("[v0] All data refreshed")
}
