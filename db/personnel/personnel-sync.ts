/**
 * Personnel sync operations
 */
import { db } from "../core/database"
import type { Personnel } from "./personnel-types"

export async function upsertPersonnelFromServer(serverPersonnel: Personnel): Promise<void> {
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
    mongoId: serverPersonnel.mongoId,
  }

  let existing: Personnel | undefined
  if (normalized.mongoId) {
    existing = await db.personnel.where("mongoId").equals(normalized.mongoId).first()
  }
  if (!existing && normalized.id) {
    existing = await db.personnel.get(normalized.id)
  }

  if (existing) {
    const serverTime = normalized.updatedAt || normalized.createdAt
    const localTime = existing.updatedAt || existing.createdAt
    if (serverTime >= localTime) {
      await db.personnel.put({ ...normalized, id: existing.id })
    }
  } else {
    await db.personnel.put(normalized)
  }
}
