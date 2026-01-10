/**
 * Aircraft database store operations (CDN aircraft reference - read-only)
 */

import { referenceDb } from "../../reference-db"
import type { AircraftReference } from "@/types/entities/aircraft.types"

/**
 * Add aircraft to reference database (from CDN lookup)
 */
export async function addAircraftToDatabase(registration: string, data: string): Promise<void> {
  await referenceDb.aircraftDatabase.put({ registration: registration.toUpperCase(), data })
}

/**
 * Get aircraft from reference database
 */
export async function getAircraftFromDatabase(registration: string): Promise<AircraftReference | undefined> {
  return referenceDb.aircraftDatabase.get(registration.toUpperCase())
}

/**
 * Delete aircraft from reference database
 */
export async function deleteAircraftFromDatabase(registration: string): Promise<boolean> {
  const aircraft = await referenceDb.aircraftDatabase.get(registration.toUpperCase())
  if (!aircraft) return false

  await referenceDb.aircraftDatabase.delete(registration.toUpperCase())
  return true
}

/**
 * Get all aircraft from reference database
 */
export async function getAllAircraftFromDatabase(): Promise<AircraftReference[]> {
  return referenceDb.aircraftDatabase.toArray()
}

/**
 * Check if aircraft exists in reference database
 */
export async function hasAircraftInDatabase(registration: string): Promise<boolean> {
  const aircraft = await referenceDb.aircraftDatabase.get(registration.toUpperCase())
  return !!aircraft
}
