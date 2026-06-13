/**
 * Aircraft store operations (user-owned aircraft)
 */

import { userDb } from "../../user-db";
import type { Aircraft, AircraftCreate } from "@/types/entities/aircraft.types";
import { createEntity, updateEntity, deleteEntity, silentDeleteEntity, upsertFromServer } from "./crud-helpers";

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
 * Get all aircraft
 */
export async function getAllAircraft(): Promise<Aircraft[]> {
  return userDb.aircraft.toArray();
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
