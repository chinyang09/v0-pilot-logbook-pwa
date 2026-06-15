/**
 * Crew/Personnel store operations
 */

import { userDb } from "../../user-db";
import type {
  Personnel,
  PersonnelCreate,
  PersonnelRole,
} from "@/types/entities/crew.types";
import { createEntity, updateEntity, deleteEntity, silentDeleteEntity, upsertFromServer } from "./crud-helpers";

/**
 * Add new personnel
 */
export async function addPersonnel(
  personnel: PersonnelCreate
): Promise<Personnel> {
  return createEntity<Personnel>(userDb.personnel, "personnel", personnel, { includeUpdatedAt: false });
}

/**
 * Update existing personnel
 */
export async function updatePersonnel(
  id: string,
  updates: Partial<Personnel>
): Promise<Personnel | null> {
  return updateEntity<Personnel>(userDb.personnel, "personnel", id, updates);
}

/**
 * Delete personnel
 */
export async function deletePersonnel(id: string): Promise<boolean> {
  return deleteEntity<Personnel>(userDb.personnel, "personnel", id);
}

/**
 * Delete personnel without adding to sync queue
 */
export async function silentDeletePersonnel(id: string): Promise<boolean> {
  return silentDeleteEntity<Personnel>(userDb.personnel, id);
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
 * Normalize a server personnel record, filling defaults for any missing fields
 */
function normalizePersonnelFromServer(serverPersonnel: Personnel): Personnel {
  return {
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
    serverSeq: serverPersonnel.serverSeq,
    deviceId: serverPersonnel.deviceId,
  };
}

/**
 * Upsert personnel from server (for sync)
 */
export async function upsertPersonnelFromServer(
  serverPersonnel: Personnel
): Promise<void> {
  return upsertFromServer<Personnel>(userDb.personnel, serverPersonnel, normalizePersonnelFromServer);
}
