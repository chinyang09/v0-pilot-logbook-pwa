/**
 * Aircraft store operations (user-owned aircraft)
 */

import { userDb } from "../../user-db";
import type { Aircraft, AircraftCreate } from "@/types/entities/aircraft.types";
import {
  createEntity,
  updateEntity,
  deleteEntity,
  silentDeleteEntity,
  upsertFromServer,
  restoreEntity,
  purgeEntity,
  purgeExpiredEntities,
  isLiveEntity,
} from "./crud-helpers";

/**
 * Add new aircraft
 */
export async function addAircraft(aircraft: AircraftCreate): Promise<Aircraft> {
  return createEntity<Aircraft>(userDb.aircraft, "aircraft", aircraft, { includeUpdatedAt: false });
}

/**
 * Update existing aircraft
 */
export async function updateAircraft(
  id: string,
  updates: Partial<Aircraft>
): Promise<Aircraft | null> {
  return updateEntity<Aircraft>(userDb.aircraft, "aircraft", id, updates);
}

/**
 * Delete aircraft
 */
export async function deleteAircraft(id: string): Promise<boolean> {
  return deleteEntity<Aircraft>(userDb.aircraft, "aircraft", id);
}

/**
 * Delete aircraft without adding to sync queue
 */
export async function silentDeleteAircraft(id: string): Promise<boolean> {
  return silentDeleteEntity<Aircraft>(userDb.aircraft, id);
}

/**
 * Put a soft-deleted aircraft back — see `deleteAircraft`.
 */
export async function restoreAircraft(id: string): Promise<boolean> {
  return restoreEntity<Aircraft>(userDb.aircraft, "aircraft", id);
}

/** Destroy it now rather than in 30 days. Writes a tombstone. */
export async function permanentlyDeleteAircraft(id: string): Promise<boolean> {
  return purgeEntity<Aircraft>(userDb.aircraft, "aircraft", id);
}

/** Sweep whatever has run out its 30 days. */
export async function purgeExpiredDeletedAircraft(): Promise<number> {
  return purgeExpiredEntities<Aircraft>(userDb.aircraft, "aircraft");
}

/** Everything currently in Recently Deleted, newest first. */
export async function getDeletedAircraft(): Promise<Aircraft[]> {
  const all = await userDb.aircraft.toArray();
  return all
    .filter((e) => e.deletedAt != null)
    .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
}


/**
 * Get all aircraft
 */
export async function getAllAircraft(): Promise<Aircraft[]> {
  // LIVE rows only — a deleted aircraft is in Recently Deleted, and a list, a
  // total or an import match must never see it (see isLiveEntity).
  return (await userDb.aircraft.toArray()).filter(isLiveEntity);
}

/**
 * Get aircraft by ID
 */
export async function getAircraftById(
  id: string
): Promise<Aircraft | undefined> {
  return userDb.aircraft.get(id);
}

/**
 * Normalize a server aircraft record, filling defaults for any missing fields
 */
function normalizeAircraftFromServer(serverAircraft: Aircraft): Aircraft {
  return {
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
    serverSeq: serverAircraft.serverSeq,
    deviceId: serverAircraft.deviceId,
  };
}

/**
 * Upsert aircraft from server (for sync)
 */
export async function upsertAircraftFromServer(
  serverAircraft: Aircraft
): Promise<void> {
  return upsertFromServer<Aircraft>(userDb.aircraft, serverAircraft, normalizeAircraftFromServer);
}
