/**
 * Airport-related type definitions
 * Note: Airports are reference data - no userId, no syncStatus
 */

export interface Airport {
  id: number
  icao: string
  iata: string
  name: string
  city: string
  state: string
  country: string
  latitude: number
  longitude: number
  elevation: number
  tz: string // IANA timezone string
  isFavorite?: boolean
}

export type AirportCreate = Omit<Airport, "id">
