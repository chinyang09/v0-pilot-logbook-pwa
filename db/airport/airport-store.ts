/**
 * Airport Dexie operations
 */
import { db } from "../core/database"
import type { Airport } from "./airport-types"

export async function getAllAirports(): Promise<Airport[]> {
  return db.airports.toArray()
}

export async function getAirportByIcao(icao: string): Promise<Airport | undefined> {
  if (!icao) return undefined
  return db.airports.get(icao.toUpperCase())
}

export async function getAirportByIata(iata: string): Promise<Airport | undefined> {
  return db.airports.where("iata").equals(iata.toUpperCase()).first()
}

export async function getAirportById(id: number): Promise<Airport | undefined> {
  return db.airports.where("id").equals(id).first()
}

export async function toggleAirportFavorite(icao: string): Promise<boolean> {
  const airport = await db.airports.get(icao.toUpperCase())
  if (!airport) return false

  const newStatus = !airport.isFavorite
  await db.airports.update(icao.toUpperCase(), { isFavorite: newStatus })
  return newStatus
}

export async function getFavoriteAirports(): Promise<Airport[]> {
  return db.airports.where("isFavorite").equals(1).toArray()
}

export async function bulkLoadAirports(rawData: Record<string, any>): Promise<void> {
  // Get current favorites first
  const existingFavorites = await db.airports.where("isFavorite").equals(1).toArray()
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
      isFavorite: favoriteIcaos.has(airport.icao) ? 1 : (0 as any),
    }))
    .filter((a) => a.icao)

  await db.transaction("rw", db.airports, db.syncMeta, async () => {
    await db.airports.clear()
    await db.airports.bulkPut(airports)
    await db.syncMeta.put({ key: "airport_version", lastSyncAt: Date.now() })
  })
}

export async function addCustomAirport(airport: Omit<Airport, "icao"> & { icao: string }): Promise<void> {
  await db.airports.put(airport)
}
