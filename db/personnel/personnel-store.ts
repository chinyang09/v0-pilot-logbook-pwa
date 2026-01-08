/**
 * Personnel Dexie operations
 */
import { db } from "../core/database"
import { addToSyncQueue } from "../core/sync-queue-store"
import type { Personnel } from "./personnel-types"
import { generateULID } from "../utils/ulid"

export async function addPersonnel(personnel: Omit<Personnel, "id" | "createdAt" | "syncStatus">): Promise<Personnel> {
  const newPersonnel: Personnel = {
    ...personnel,
    id: generateULID(),
    createdAt: Date.now(),
    syncStatus: "pending",
  }

  await db.personnel.put(newPersonnel)
  await addToSyncQueue("create", "personnel", newPersonnel)

  return newPersonnel
}

export async function updatePersonnel(id: string, updates: Partial<Personnel>): Promise<Personnel | null> {
  const person = await db.personnel.get(id)
  if (!person) return null

  const updatedPersonnel: Personnel = {
    ...person,
    ...updates,
    updatedAt: Date.now(),
    syncStatus: "pending",
  }

  await db.personnel.put(updatedPersonnel)
  await addToSyncQueue("update", "personnel", updatedPersonnel)

  return updatedPersonnel
}

export async function deletePersonnel(id: string): Promise<boolean> {
  const person = await db.personnel.get(id)
  if (!person) return false

  await db.personnel.delete(id)
  await addToSyncQueue("delete", "personnel", { id, mongoId: person.mongoId })
  return true
}

export async function silentDeletePersonnel(id: string): Promise<boolean> {
  const person = await db.personnel.get(id)
  if (!person) {
    const byMongoPattern = await db.personnel.filter((p) => p.id === id || p.mongoId === id).first()
    if (byMongoPattern) {
      await db.personnel.delete(byMongoPattern.id)
      return true
    }
    return false
  }
  await db.personnel.delete(id)
  return true
}

export async function getAllPersonnel(): Promise<Personnel[]> {
  return db.personnel.toArray()
}

export async function getPersonnelById(id: string): Promise<Personnel | undefined> {
  return db.personnel.get(id)
}

export async function getCurrentUserPersonnel(): Promise<Personnel | null> {
  const meRecord = await db.personnel.filter((p) => p.isMe === true).first()
  return meRecord || null
}

export async function getPersonnelByRole(role: Personnel["roles"][number]): Promise<Personnel[]> {
  return db.personnel.filter((p) => p.roles?.includes(role)).toArray()
}
