/**
 * Aircraft Dexie operations
 */
import { db } from "../core/database"
import { addToSyncQueue } from "../core/sync-queue-store"
import type { Aircraft } from "./aircraft-types"
import { generateULID } from "../utils/ulid"

export async function addAircraft(aircraft: Omit<Aircraft, "id" | "createdAt" | "syncStatus">): Promise<Aircraft> {
  const newAircraft: Aircraft = {
    ...aircraft,
    id: generateULID(),
    createdAt: Date.now(),
    syncStatus: "pending",
  }

  await db.aircraft.put(newAircraft)
  await addToSyncQueue("create", "aircraft", newAircraft)

  return newAircraft
}

export async function updateAircraft(id: string, updates: Partial<Aircraft>): Promise<Aircraft | null> {
  const aircraft = await db.aircraft.get(id)
  if (!aircraft) return null

  const updatedAircraft: Aircraft = {
    ...aircraft,
    ...updates,
    updatedAt: Date.now(),
    syncStatus: "pending",
  }

  await db.aircraft.put(updatedAircraft)
  await addToSyncQueue("update", "aircraft", updatedAircraft)

  return updatedAircraft
}

export async function deleteAircraft(id: string): Promise<boolean> {
  const aircraft = await db.aircraft.get(id)
  if (!aircraft) return false

  await db.aircraft.delete(id)
  await addToSyncQueue("delete", "aircraft", { id, mongoId: aircraft.mongoId })
  return true
}

export async function silentDeleteAircraft(id: string): Promise<boolean> {
  const aircraft = await db.aircraft.get(id)
  if (!aircraft) {
    const byMongoPattern = await db.aircraft.filter((a) => a.id === id || a.mongoId === id).first()
    if (byMongoPattern) {
      await db.aircraft.delete(byMongoPattern.id)
      return true
    }
    return false
  }
  await db.aircraft.delete(id)
  return true
}

export async function getAllAircraft(): Promise<Aircraft[]> {
  return db.aircraft.toArray()
}

export async function getAircraftById(id: string): Promise<Aircraft | undefined> {
  return db.aircraft.get(id)
}
