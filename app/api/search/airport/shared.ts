/**
 * Shared types/constants for the airport search routes.
 *
 * Kept out of the `route.ts` files because Next.js route modules may only export
 * route handlers (GET/POST/…) and a small set of config exports — exporting
 * anything else fails the generated route type check.
 */

// Records older than this are treated as stale so callers fall through to FR24
// and refresh the cache. Airport reference data is unusually stable, so 180 days
// comfortably catches policy-level timezone changes within a half-year without
// hammering FR24.
export const AIRPORT_CACHE_TTL_MS = 180 * 24 * 60 * 60 * 1000 // 180 days

export type EnrichedAirport = {
  icao: string
  iata: string
  name: string
  city: string
  country: string
  countryCode: string
  latitude: number
  longitude: number
  elevation: number
  timezone: string
}
