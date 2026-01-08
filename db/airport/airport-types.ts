/**
 * Airport domain types
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
  tz: string
  isFavorite?: boolean
}

// Extended airport data from CDN/local source
export interface AirportData {
  id: number
  icao: string
  iata: string
  name: string
  city: string
  state: string
  country: string
  latitude: number
  longitude: number
  altitude: number
  tz: string
  source: string
}
