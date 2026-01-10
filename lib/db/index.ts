/**
 * Database exports
 *
 * This module provides access to both databases:
 * - userDb: User-specific data (cleared on logout)
 * - referenceDb: Reference data (persists across sessions)
 */

export { userDb, initializeUserDB } from "./user-db"
export { referenceDb, initializeReferenceDB } from "./reference-db"

// Re-export types
export type { FlightLog, Approach, AdditionalCrew, SyncStatus } from "@/types/entities/flight.types"
export type { Aircraft, AircraftReference } from "@/types/entities/aircraft.types"
export type { Airport } from "@/types/entities/airport.types"
export type { Personnel } from "@/types/entities/crew.types"
export type { UserSession } from "@/types/entities/user.types"
export type { UserPreferences } from "@/types/db/stores.types"
export type { SyncQueueItem, SyncMeta } from "@/types/sync/sync.types"

/**
 * Initialize both databases
 */
export async function initializeDB(): Promise<boolean> {
  const { initializeUserDB } = await import("./user-db")
  const { initializeReferenceDB } = await import("./reference-db")

  const [userReady, refReady] = await Promise.all([
    initializeUserDB(),
    initializeReferenceDB(),
  ])

  return userReady && refReady
}
