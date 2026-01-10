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
export type { FlightLog, FlightLogCreate, Approach, AdditionalCrew, SyncStatus } from "@/types/entities/flight.types"
export type { Aircraft, AircraftCreate, AircraftReference } from "@/types/entities/aircraft.types"
export type { Airport } from "@/types/entities/airport.types"
export type { Personnel, PersonnelCreate } from "@/types/entities/crew.types"
export type { UserSession } from "@/types/entities/user.types"
export type { UserPreferences } from "@/types/db/stores.types"
export type { SyncQueueItem, SyncMeta } from "@/types/sync/sync.types"

// Re-export user stores
export {
  addFlight,
  updateFlight,
  deleteFlight,
  silentDeleteFlight,
  getAllFlights,
  getFlightById,
  getFlightByMongoId,
  getPendingFlights,
  upsertFlightFromServer,
  markFlightSynced,
} from "./stores/user/flights.store"

export {
  addAircraft,
  updateAircraft,
  deleteAircraft,
  silentDeleteAircraft,
  getAllAircraft,
  getAircraftById,
  upsertAircraftFromServer,
} from "./stores/user/aircraft.store"

export {
  addPersonnel,
  updatePersonnel,
  deletePersonnel,
  silentDeletePersonnel,
  getAllPersonnel,
  getPersonnelById,
  getCurrentUserPersonnel,
  getPersonnelByRole,
  upsertPersonnelFromServer,
} from "./stores/user/crew.store"

export {
  saveUserSession,
  getUserSession,
  clearUserSession,
  getCurrentUserId,
} from "./stores/user/sessions.store"

export {
  getUserPreferences,
  saveUserPreferences,
  getDefaultFieldOrder,
  addRecentlyUsedAirport,
  getRecentlyUsedAirports,
  addRecentlyUsedAircraft,
  getRecentlyUsedAircraft,
} from "./stores/user/preferences.store"

export {
  addToSyncQueue,
  getSyncQueue,
  getSyncQueueByCollection,
  clearSyncQueueItem,
  clearSyncQueueByCollection,
  incrementRetryCount,
  getLastSyncTime,
  setLastSyncTime,
  markRecordSynced,
} from "./stores/user/sync-queue.store"

// Re-export reference stores - airports
export {
  getAllAirports,
  getAirportByIcao,
  getAirportByIata,
  getAirportById,
  bulkLoadAirports,
  addCustomAirport,
  toggleAirportFavorite,
  getFavoriteAirports,
  getAirportLocalTime,
  getAirportDatabase,
  searchAirports,
  getAirportTimeInfo,
  formatAirport,
  getAirportByICAO,
  getAirportByIATA,
  type AirportData,
} from "./stores/reference/airports.store"

// Re-export reference stores - aircraft database
export {
  // Types
  type AircraftData,
  type NormalizedAircraft,
  // Initialization
  initializeAircraftDatabase,
  quickInit,
  isAircraftDatabaseReady,
  isAircraftDatabaseLoaded,
  getAircraftMetadata,
  clearAircraftCache,
  setProgressCallback,
  // Search (DB-based - recommended)
  searchAircraftFromDB,
  getAircraftByRegistrationFromDB,
  getAircraftByIcao24FromDB,
  // Legacy search (in-memory)
  getAircraftDatabase,
  searchAircraft,
  getAircraftByRegistration,
  getAircraftByIcao24,
  loadIntoMemory,
  // Helpers
  normalizeAircraft,
  formatAircraft,
  // CRUD
  addAircraftToDatabase,
  getAircraftFromDatabase,
  deleteAircraftFromDatabase,
  getAllAircraftFromDatabase,
  hasAircraftInDatabase,
} from "./stores/reference/aircraft.store"

// Re-export metadata stores
export { getFlightStats, type FlightStats } from "./stores/metadata/stats.store"

// Import userDb for clearAllUserData
import { userDb } from "./user-db"

/**
 * Clear all user data (called on logout)
 */
export async function clearAllUserData(): Promise<void> {
  await userDb.clearAllUserData()
}

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
