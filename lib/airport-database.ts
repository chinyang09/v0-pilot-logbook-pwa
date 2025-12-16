/**
 * Airport Database Loader
 * Loads airport data from CDN and caches in IndexedDB
 * Provides search and lookup functionality
 */

export interface AirportData {
  id: number
  icao: string
  iata: string
  name: string
  city: string
  country: string
  latitude: number
  longitude: number
  altitude: number
  timezone: number // UTC offset as number
  dst: string
  tz: string // Timezone name e.g., "America/Los_Angeles"
  type: string
  source: string
}

const AIRPORT_CDN_URL = "https://cdn.jsdelivr.net/npm/@nwpr/airport-codes@3.0.3/dist/airports.json"
const CACHE_KEY = "airport-database-cache"
const CACHE_VERSION = "2.0"

/**
 * Load airports from CDN and normalize to our format
 */
async function loadAirportsFromCDN(): Promise<AirportData[]> {
  try {
    const response = await fetch(AIRPORT_CDN_URL)
    if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`)

    const data = await response.json()

    return data
      .map((airport: any) => ({
        id: airport.id || 0,
        icao: airport.icao || "",
        iata: airport.iata || "",
        name: airport.name || "",
        city: airport.city || "",
        country: airport.country || "",
        latitude: airport.latitude || 0,
        longitude: airport.longitude || 0,
        altitude: airport.altitude || 0,
        timezone: airport.timezone || 0,
        dst: airport.dst || "",
        tz: airport.tz || "UTC",
        type: airport.type || "",
        source: airport.source || "",
      }))
      .filter((a: AirportData) => a.icao) // Only keep airports with ICAO codes
  } catch (error) {
    console.error("[Airport DB] Failed to load airports from CDN:", error)
    return []
  }
}

/**
 * Get airports from cache or load from CDN
 */
export async function getAirportDatabase(): Promise<AirportData[]> {
  // Check localStorage cache first
  const cached = localStorage.getItem(CACHE_KEY)
  const cacheVersion = localStorage.getItem(`${CACHE_KEY}-version`)

  if (cached && cacheVersion === CACHE_VERSION) {
    try {
      return JSON.parse(cached)
    } catch (error) {
      console.error("[Airport DB] Failed to parse cached airports:", error)
    }
  }

  // Load from CDN
  const airports = await loadAirportsFromCDN()

  // Cache in localStorage
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(airports))
    localStorage.setItem(`${CACHE_KEY}-version`, CACHE_VERSION)
  } catch (error) {
    console.error("[Airport DB] Failed to cache airports:", error)
  }

  return airports
}

/**
 * Search airports by ICAO, IATA, name, or city
 */
export function searchAirports(airports: AirportData[], query: string, limit = 10): AirportData[] {
  if (!query) return []

  const q = query.toLowerCase().trim()

  const matches: Array<{ airport: AirportData; score: number }> = []

  for (const airport of airports) {
    let score = 0

    // Exact ICAO match (highest priority)
    if (airport.icao.toLowerCase() === q) {
      score = 1000
    }
    // ICAO starts with query
    else if (airport.icao.toLowerCase().startsWith(q)) {
      score = 900
    }
    // Exact IATA match
    else if (airport.iata && airport.iata.toLowerCase() === q) {
      score = 800
    }
    // IATA starts with query
    else if (airport.iata && airport.iata.toLowerCase().startsWith(q)) {
      score = 700
    }
    // Name starts with query
    else if (airport.name.toLowerCase().startsWith(q)) {
      score = 600
    }
    // City starts with query
    else if (airport.city.toLowerCase().startsWith(q)) {
      score = 500
    }
    // Name contains query
    else if (airport.name.toLowerCase().includes(q)) {
      score = 400
    }
    // City contains query
    else if (airport.city.toLowerCase().includes(q)) {
      score = 300
    }
    // Country contains query
    else if (airport.country.toLowerCase().includes(q)) {
      score = 200
    }

    if (score > 0) {
      matches.push({ airport, score })
    }
  }

  // Sort by score descending
  matches.sort((a, b) => b.score - a.score)

  return matches.slice(0, limit).map((m) => m.airport)
}

/**
 * Get airport by ICAO code
 */
export function getAirportByICAO(airports: AirportData[], icao: string): AirportData | undefined {
  return airports.find((a) => a.icao.toUpperCase() === icao.toUpperCase())
}

/**
 * Get airport by IATA code
 */
export function getAirportByIATA(airports: AirportData[], iata: string): AirportData | undefined {
  return airports.find((a) => a.iata && a.iata.toUpperCase() === iata.toUpperCase())
}

/**
 * Format airport for display
 */
export function formatAirport(airport: AirportData): string {
  const parts = [airport.icao]
  if (airport.iata) parts.push(`(${airport.iata})`)
  parts.push(`- ${airport.name}`)
  if (airport.city) parts.push(`- ${airport.city}`)
  return parts.join(" ")
}
