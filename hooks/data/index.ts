/**
 * Data hooks barrel export
 *
 * Domain-specific hooks for accessing IndexedDB data with SWR caching
 */

// Core utilities
export { CACHE_KEYS, useDBReady, refreshAllData, checkDBReady } from "./use-db"

// Domain hooks
export { useFlights, useFlightStats } from "./use-flights"
export { useAircraft } from "./use-aircraft"
export { useAirports, useAirportDatabase } from "./use-airports"
export { usePersonnel } from "./use-crew"
