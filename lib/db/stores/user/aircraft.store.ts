/**
 * Aircraft store operations (user-owned aircraft)
 */

import { userDb } from "../../user-db"
import type { Aircraft, AircraftCreate } from "@/types/entities/aircraft.types"
import { addToSyncQueue } from "./sync-queue.store"

/**
 * Add new aircraft
 */
export async function addAircraft(aircraft: AircraftCreate): Promise<Aircraft> {
  const newAircraft: Aircraft = {
    ...aircraft,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    syncStatus: "pending",
  }

  await userDb.aircraft.put(newAircraft)
  await addToSyncQueue("create", "aircraft", newAircraft)

  return newAircraft
}

/**
 * Update existing aircraft
 */
export async function updateAircraft(id: string, updates: Partial<Aircraft>): Promise<Aircraft | null> {
  const aircraft = await userDb.aircraft.get(id)
  if (!aircraft) return null

  const updatedAircraft: Aircraft = {
    ...aircraft,
    ...updates,
    updatedAt: Date.now(),
    syncStatus: "pending",
  }

  await userDb.aircraft.put(updatedAircraft)
  await addToSyncQueue("update", "aircraft", updatedAircraft)

  return updatedAircraft
}

/**
 * Delete aircraft
 */
export async function deleteAircraft(id: string): Promise<boolean> {
  const aircraft = await userDb.aircraft.get(id)
  if (!aircraft) return false

  await userDb.aircraft.delete(id)
  await addToSyncQueue("delete", "aircraft", { id, mongoId: aircraft.mongoId })
  return true
}

/**
 * Delete aircraft without adding to sync queue
 */
export async function silentDeleteAircraft(id: string): Promise<boolean> {
  const aircraft = await userDb.aircraft.get(id)
  if (!aircraft) {
    const byMongoPattern = await userDb.aircraft.filter((a) => a.id === id || a.mongoId === id).first()
    if (byMongoPattern) {
      await userDb.aircraft.delete(byMongoPattern.id)
      return true
    }
    return false
  }
  await userDb.aircraft.delete(id)
  return true
}

/**
 * Get all aircraft
 */
export async function getAllAircraft(): Promise<Aircraft[]> {
  return userDb.aircraft.toArray()
}

/**
 * Get aircraft by ID
 */
export async function getAircraftById(id: string): Promise<Aircraft | undefined> {
  return userDb.aircraft.get(id)
}

/**
 * Upsert aircraft from server (for sync)
 */
export async function upsertAircraftFromServer(serverAircraft: Aircraft): Promise<void> {
  const normalized: Aircraft = {
    id: serverAircraft.id,
    userId: serverAircraft.userId,
    registration: serverAircraft.registration,
    type: serverAircraft.type,
    typeDesignator: serverAircraft.typeDesignator || "",
    model: serverAircraft.model || "",
    category: serverAircraft.category || "",
    engineType: serverAircraft.engineType || "SEP",
    isComplex: serverAircraft.isComplex || false,
    isHighPerformance: serverAircraft.isHighPerformance || false,
    createdAt: serverAircraft.createdAt || Date.now(),
    updatedAt: serverAircraft.updatedAt,
    syncStatus: "synced",
    mongoId: serverAircraft.mongoId,
  }

  let existing: Aircraft | undefined
  if (normalized.mongoId) {
    existing = await userDb.aircraft.where("mongoId").equals(normalized.mongoId).first()
  }
  if (!existing && normalized.id) {
    existing = await userDb.aircraft.get(normalized.id)
  }

  if (existing) {
    const serverTime = normalized.updatedAt || normalized.createdAt
    const localTime = existing.updatedAt || existing.createdAt
    if (serverTime >= localTime) {
      await userDb.aircraft.put({ ...normalized, id: existing.id })
    }
  } else {
    await userDb.aircraft.put(normalized)
  }
}
