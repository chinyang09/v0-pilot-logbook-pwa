/**
 * Aircraft Store - CRUD operations for user's aircraft
 * USER DATA - syncs with MongoDB
 */

import { userDb } from "../user-db"
import { addToSyncQueue } from "./sync-queue.store"
import { ulid } from "@/lib/utils/ulid"
import type { UserAircraft, UserAircraftInput, UserAircraftUpdate } from "@/types/entities/aircraft.types"

/**
 * Create new aircraft
 */
export async function createAircraft(input: UserAircraftInput): Promise<UserAircraft> {
  const now = Date.now()
  const aircraft: UserAircraft = {
    ...input,
    id: ulid(),
    createdAt: now,
    updatedAt: now,
    syncStatus: "pending",
  }

  await userDb.aircraft.put(aircraft)
  await addToSyncQueue("create", "aircraft", aircraft)

  return aircraft
}

/**
 * Update aircraft
 */
export async function updateAircraft(id: string, updates: UserAircraftUpdate): Promise<UserAircraft | null> {
  const aircraft = await userDb.aircraft.get(id)
  if (!aircraft) return null

  const updatedAircraft: UserAircraft = {
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
 * Delete aircraft without sync queue
 */
export async function silentDeleteAircraft(id: string): Promise<boolean> {
  const aircraft = await userDb.aircraft.get(id)
  if (!aircraft) {
    const byMongo = await userDb.aircraft.filter((a) => a.mongoId === id).first()
    if (byMongo) {
      await userDb.aircraft.delete(byMongo.id)
      return true
    }
    return false
  }
  await userDb.aircraft.delete(id)
  return true
}

/**
 * Get all user aircraft
 */
export async function getAllAircraft(): Promise<UserAircraft[]> {
  return userDb.aircraft.toArray()
}

/**
 * Get aircraft by ID
 */
export async function getAircraftById(id: string): Promise<UserAircraft | undefined> {
  return userDb.aircraft.get(id)
}

/**
 * Get aircraft by registration
 */
export async function getAircraftByRegistration(registration: string): Promise<UserAircraft | undefined> {
  return userDb.aircraft.where("registration").equalsIgnoreCase(registration).first()
}

/**
 * Upsert aircraft from server
 */
export async function upsertAircraftFromServer(serverAircraft: UserAircraft): Promise<void> {
  const normalized: UserAircraft = {
    id: serverAircraft.id,
    userId: serverAircraft.userId || "",
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

  let existing: UserAircraft | undefined
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

/**
 * Mark aircraft as synced
 */
export async function markAircraftSynced(id: string, mongoId: string): Promise<void> {
  await userDb.aircraft.update(id, {
    syncStatus: "synced",
    mongoId,
  })
}
