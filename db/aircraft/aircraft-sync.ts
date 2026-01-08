/**
 * Aircraft sync operations
 */
import { db } from "../core/database"
import type { Aircraft } from "./aircraft-types"

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
    existing = await db.aircraft.where("mongoId").equals(normalized.mongoId).first()
  }
  if (!existing && normalized.id) {
    existing = await db.aircraft.get(normalized.id)
  }

  if (existing) {
    const serverTime = normalized.updatedAt || normalized.createdAt
    const localTime = existing.updatedAt || existing.createdAt
    if (serverTime >= localTime) {
      await db.aircraft.put({ ...normalized, id: existing.id })
    }
  } else {
    await db.aircraft.put(normalized)
  }
}
