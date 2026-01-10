/**
 * Airports store operations (reference data - read-only)
 */

import { referenceDb } from "../../reference-db"
import type { Airport } from "@/types/entities/airport.types"

const DATA_VERSION = "2025.10.27-min"

/**
 * Get all airports
 */
export async function getAllAirports(): Promise<Airport[]> {
  return referenceDb.airports.toArray()
}

/**
 * Get airport by ICAO code
 */
export async function getAirportByIcao(icao: string): Promise<Airport | undefined> {
  if (!icao) return undefined
  return referenceDb.airports.get(icao.toUpperCase())
}

/**
 * Get airport by IATA code
 */
export async function getAirportByIata(iata: string): Promise<Airport | undefined> {
  return referenceDb.airports.where("iata").equals(iata.toUpperCase()).first()
}

/**
 * Get airport by ID
 */
export async function getAirportById(id: number): Promise<Airport | undefined> {
  return referenceDb.airports.where("id").equals(id).first()
}

/**
 * Bulk load airports from JSON data
 */
export async function bulkLoadAirports(rawData: Record<string, any>): Promise<void> {
  // Get current favorites first
  const existingFavorites = await referenceDb.airports.where("isFavorite").equals(1).toArray()
  const favoriteIcaos = new Set(existingFavorites.map((a) => a.icao))

  const airports: Airport[] = Object.values(rawData)
    .map((airport: any, index: number) => ({
      id: index + 1,
      icao: airport.icao || "",
      iata: airport.iata || "",
      name: airport.name || "",
      city: airport.city || "",
      state: airport.state || "",
      country: airport.country || "",
      latitude: airport.lat || 0,
      longitude: airport.lon || 0,
      elevation: airport.elevation || 0,
      tz: airport.tz || "UTC",
      // Restore favorite status if it existed
      isFavorite: favoriteIcaos.has(airport.icao) ? true : undefined,
    }))
    .filter((a) => a.icao)

  await referenceDb.transaction("rw", referenceDb.airports, referenceDb.metadata, async () => {
    await referenceDb.airports.clear()
    await referenceDb.airports.bulkPut(airports)
    await referenceDb.setMetadata("airport_version", DATA_VERSION)
  })
}

/**
 * Add custom airport
 */
export async function addCustomAirport(airport: Omit<Airport, "id"> & { icao: string }): Promise<void> {
  const existingCount = await referenceDb.airports.count()
  await referenceDb.airports.put({
    ...airport,
    id: existingCount + 1,
  } as Airport)
}

/**
 * Toggle airport favorite status
 */
export async function toggleAirportFavorite(icao: string): Promise<boolean> {
  const airport = await referenceDb.airports.get(icao.toUpperCase())
  if (!airport) return false

  const newStatus = !airport.isFavorite
  await referenceDb.airports.update(icao.toUpperCase(), { isFavorite: newStatus })
  return newStatus
}

/**
 * Get favorite airports
 */
export async function getFavoriteAirports(): Promise<Airport[]> {
  return referenceDb.airports.where("isFavorite").equals(1).toArray()
}

/**
 * Get airport local time display string
 */
export function getAirportLocalTime(tz: string): string {
  try {
    const now = new Date()
    const offsetStr =
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        timeZoneName: "shortOffset",
      })
        .formatToParts(now)
        .find((p) => p.type === "timeZoneName")?.value || "UTC"

    const timeStr = now.toLocaleTimeString("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
    })

    return `${timeStr} (${offsetStr})`
  } catch {
    return "Time Unavailable"
  }
}
