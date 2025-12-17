export interface UserPreferences {
  key: string // Changed from 'id' to match Dexie schema
  fieldOrder: {
    flight: string[]
    time: string[]
    crew: string[]
    landings: string[]
    approaches: string[]
    notes: string[]
  }
  visibleFields: Record<string, boolean>
  recentlyUsedAirports?: string[]
  recentlyUsedAircraft?: string[]
  createdAt: number
  updatedAt: number
}

const RECENTLY_USED_AIRPORTS_KEY = "recently-used-airports"
const RECENTLY_USED_AIRCRAFT_KEY = "recently-used-aircraft"
const MAX_RECENT_ITEMS = 10

/**
 * Add an airport to recently used list
 */
export function addRecentlyUsedAirport(icao: string): void {
  if (typeof window === "undefined" || !icao) return

  try {
    const stored = localStorage.getItem(RECENTLY_USED_AIRPORTS_KEY)
    let recent: string[] = stored ? JSON.parse(stored) : []

    // Remove if already exists and add to front
    recent = recent.filter((code) => code !== icao)
    recent.unshift(icao)

    // Limit to max items
    recent = recent.slice(0, MAX_RECENT_ITEMS)

    localStorage.setItem(RECENTLY_USED_AIRPORTS_KEY, JSON.stringify(recent))
  } catch (error) {
    console.error("Failed to save recently used airport:", error)
  }
}

/**
 * Get recently used airports
 */
export function getRecentlyUsedAirports(): string[] {
  if (typeof window === "undefined") return []

  try {
    const stored = localStorage.getItem(RECENTLY_USED_AIRPORTS_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

/**
 * Add an aircraft to recently used list
 */
export function addRecentlyUsedAircraft(registration: string): void {
  if (typeof window === "undefined" || !registration) return

  try {
    const stored = localStorage.getItem(RECENTLY_USED_AIRCRAFT_KEY)
    let recent: string[] = stored ? JSON.parse(stored) : []

    // Remove if already exists and add to front
    recent = recent.filter((reg) => reg !== registration)
    recent.unshift(registration)

    // Limit to max items
    recent = recent.slice(0, MAX_RECENT_ITEMS)

    localStorage.setItem(RECENTLY_USED_AIRCRAFT_KEY, JSON.stringify(recent))
  } catch (error) {
    console.error("Failed to save recently used aircraft:", error)
  }
}

/**
 * Get recently used aircraft
 */
export function getRecentlyUsedAircraft(): string[] {
  if (typeof window === "undefined") return []

  try {
    const stored = localStorage.getItem(RECENTLY_USED_AIRCRAFT_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}
