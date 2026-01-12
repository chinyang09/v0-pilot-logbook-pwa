/**
 * Crew Store - CRUD operations for crew/personnel
 * USER DATA - syncs with MongoDB
 */

import { userDb } from "../user-db"
import { addToSyncQueue } from "./sync-queue.store"
import { ulid } from "@/lib/utils/ulid"
import type { Crew, CrewInput, CrewUpdate } from "@/types/entities/crew.types"

/**
 * Create new crew member
 */
export async function createCrew(input: CrewInput): Promise<Crew> {
  const now = Date.now()
  const crew: Crew = {
    ...input,
    id: ulid(),
    createdAt: now,
    updatedAt: now,
    syncStatus: "pending",
  }

  await userDb.crew.put(crew)
  await addToSyncQueue("create", "crew", crew)

  return crew
}

/**
 * Update crew member
 */
export async function updateCrew(id: string, updates: CrewUpdate): Promise<Crew | null> {
  const crew = await userDb.crew.get(id)
  if (!crew) return null

  const updatedCrew: Crew = {
    ...crew,
    ...updates,
    updatedAt: Date.now(),
    syncStatus: "pending",
  }

  await userDb.crew.put(updatedCrew)
  await addToSyncQueue("update", "crew", updatedCrew)

  return updatedCrew
}

/**
 * Delete crew member
 */
export async function deleteCrew(id: string): Promise<boolean> {
  const crew = await userDb.crew.get(id)
  if (!crew) return false

  await userDb.crew.delete(id)
  await addToSyncQueue("delete", "crew", { id, mongoId: crew.mongoId })

  return true
}

/**
 * Delete crew without sync queue (for server-initiated deletes)
 */
export async function silentDeleteCrew(id: string): Promise<boolean> {
  const crew = await userDb.crew.get(id)
  if (!crew) {
    const byMongo = await userDb.crew.filter((c) => c.mongoId === id).first()
    if (byMongo) {
      await userDb.crew.delete(byMongo.id)
      return true
    }
    return false
  }
  await userDb.crew.delete(id)
  return true
}

/**
 * Get all crew members
 */
export async function getAllCrew(): Promise<Crew[]> {
  return userDb.crew.toArray()
}

/**
 * Get crew by ID
 */
export async function getCrewById(id: string): Promise<Crew | undefined> {
  return userDb.crew.get(id)
}

/**
 * Get current user's "isMe" profile
 */
export async function getCurrentUserProfile(): Promise<Crew | null> {
  const me = await userDb.crew.filter((c) => c.isMe === true).first()
  return me || null
}

/**
 * Get crew by role
 */
export async function getCrewByRole(role: Crew["roles"][number]): Promise<Crew[]> {
  return userDb.crew.filter((c) => c.roles?.includes(role) || false).toArray()
}

/**
 * Upsert crew from server (during sync pull)
 */
export async function upsertCrewFromServer(serverCrew: Crew): Promise<void> {
  const normalized: Crew = {
    id: serverCrew.id,
    userId: serverCrew.userId || "",
    name: serverCrew.name || "",
    crewId: serverCrew.crewId,
    organization: serverCrew.organization,
    roles: serverCrew.roles || [],
    licenceNumber: serverCrew.licenceNumber,
    contact: serverCrew.contact,
    comment: serverCrew.comment,
    isMe: serverCrew.isMe,
    favorite: serverCrew.favorite,
    defaultPIC: serverCrew.defaultPIC,
    defaultSIC: serverCrew.defaultSIC,
    createdAt: serverCrew.createdAt || Date.now(),
    updatedAt: serverCrew.updatedAt,
    syncStatus: "synced",
    mongoId: serverCrew.mongoId,
  }

  let existing: Crew | undefined
  if (normalized.mongoId) {
    existing = await userDb.crew.where("mongoId").equals(normalized.mongoId).first()
  }
  if (!existing && normalized.id) {
    existing = await userDb.crew.get(normalized.id)
  }

  if (existing) {
    const serverTime = normalized.updatedAt || normalized.createdAt
    const localTime = existing.updatedAt || existing.createdAt
    if (serverTime >= localTime) {
      await userDb.crew.put({ ...normalized, id: existing.id })
    }
  } else {
    await userDb.crew.put(normalized)
  }
}

/**
 * Mark crew as synced
 */
export async function markCrewSynced(id: string, mongoId: string): Promise<void> {
  await userDb.crew.update(id, {
    syncStatus: "synced",
    mongoId,
  })
}
