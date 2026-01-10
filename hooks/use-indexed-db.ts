/**
 * @deprecated Import from @/hooks/data instead
 *
 * This file is kept for backward compatibility.
 * All hooks have been moved to @/hooks/data/ directory.
 */

export {
  // Core utilities
  CACHE_KEYS,
  useDBReady,
  refreshAllData,

  // Domain hooks
  useFlights,
  useFlightStats,
  useAircraft,
  useAirports,
  useAirportDatabase,
  usePersonnel,
} from "./data"
