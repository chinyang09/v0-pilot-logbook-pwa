/**
 * Airport entity type definitions
 * REFERENCE DATA - loaded from public/airports.min.json, no sync
 */

export interface Airport {
  id: number // Synthetic ID for indexing
  icao: string // Primary key
  iata: string
  name: string
  city: string
  state: string
  country: string
  latitude: number
  longitude: number
  elevation: number // feet
  tz: string // IANA timezone (e.g., "America/Los_Angeles")
  isFavorite?: boolean // User preference (stored locally)
}

/**
 * Raw airport data from JSON file
 */
export interface RawAirportData {
  icao: string
  iata?: string
  name: string
  city: string
  state?: string
  country: string
  lat: number
  lon: number
  elevation?: number
  tz: string
}

/**
 * Airport time info for display
 */
export interface AirportTimeInfo {
  offset: number // Numeric offset in hours
  offsetStr: string // Display string (e.g., "GMT+8")
  localTime?: string // Current local time string
}
