/**
 * Crew/Personnel store operations
 */

import { userDb } from "../../user-db";
import type {
  Personnel,
  PersonnelCreate,
  PersonnelRole,
} from "@/types/entities/crew.types";
import { addToSyncQueue } from "./sync-queue.store";

/**
 * Add new personnel
 */
export async function addPersonnel(
  personnel: PersonnelCreate
): Promise<Personnel> {
  const newPersonnel: Personnel = {
    ...personnel,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    syncStatus: "pending",
  };

  await userDb.personnel.put(newPersonnel);
  await addToSyncQueue("create", "personnel", newPersonnel);

  return newPersonnel;
}

/**
 * Update existing personnel
 */
export async function updatePersonnel(
  id: string,
  updates: Partial<Personnel>
): Promise<Personnel | null> {
  const person = await userDb.personnel.get(id);
  if (!person) return null;

  const updatedPersonnel: Personnel = {
    ...person,
    ...updates,
    updatedAt: Date.now(),
    syncStatus: "pending",
  };

  await userDb.personnel.put(updatedPersonnel);
  await addToSyncQueue("update", "personnel", updatedPersonnel);

  return updatedPersonnel;
}

/**
 * Delete personnel
 */
export async function deletePersonnel(id: string): Promise<boolean> {
  const person = await userDb.personnel.get(id);
  if (!person) return false;

  await userDb.personnel.delete(id);
  await addToSyncQueue("delete", "personnel", { id });
  return true;
}

/**
 * Delete personnel without adding to sync queue
 */
export async function silentDeletePersonnel(id: string): Promise<boolean> {
  const person = await userDb.personnel.get(id);
  if (!person) {
    const byMongoPattern = await userDb.personnel
      .filter((p) => p.id === id)
      .first();
    if (byMongoPattern) {
      await userDb.personnel.delete(byMongoPattern.id);
      return true;
    }
    return false;
  }
  await userDb.personnel.delete(id);
  return true;
}

/**
 * Get all personnel
 */
export async function getAllPersonnel(): Promise<Personnel[]> {
  return userDb.personnel.toArray();
}

/**
 * Get personnel by ID
 */
export async function getPersonnelById(
  id: string
): Promise<Personnel | undefined> {
  return userDb.personnel.get(id);
}

/**
 * Get the current user's personnel record
 */
export async function getCurrentUserPersonnel(): Promise<Personnel | null> {
  const meRecord = await userDb.personnel
    .filter((p) => p.isMe === true)
    .first();
  return meRecord || null;
}

/**
 * Get personnel by role
 */
export async function getPersonnelByRole(
  role: PersonnelRole
): Promise<Personnel[]> {
  return userDb.personnel
    .filter((p) => p.roles?.includes(role) ?? false)
    .toArray();
}

/**
 * Upsert personnel from server (for sync)
 */
export async function upsertPersonnelFromServer(
  serverPersonnel: Personnel
): Promise<void> {
  const normalized: Personnel = {
    id: serverPersonnel.id,
    userId: serverPersonnel.userId,
    name: serverPersonnel.name || "",
    crewId: serverPersonnel.crewId,
    organization: serverPersonnel.organization,
    roles: serverPersonnel.roles || [],
    licenceNumber: serverPersonnel.licenceNumber,
    contact: serverPersonnel.contact || {},
    comment: serverPersonnel.comment,
    isMe: serverPersonnel.isMe,
    favorite: serverPersonnel.favorite,
    defaultPIC: serverPersonnel.defaultPIC,
    defaultSIC: serverPersonnel.defaultSIC,
    createdAt: serverPersonnel.createdAt || Date.now(),
    updatedAt: serverPersonnel.updatedAt,
    syncStatus: "synced",
  };

  let existing: Personnel | undefined;
  if (normalized.id) {
    existing = await userDb.personnel.where("id").equals(normalized.id).first();
  }
  if (!existing && normalized.id) {
    existing = await userDb.personnel.get(normalized.id);
  }

  if (existing) {
    const serverTime = normalized.updatedAt || normalized.createdAt;
    const localTime = existing.updatedAt || existing.createdAt;
    if (serverTime >= localTime) {
      await userDb.personnel.put({ ...normalized, id: existing.id });
    }
  } else {
    await userDb.personnel.put(normalized);
  }
}
