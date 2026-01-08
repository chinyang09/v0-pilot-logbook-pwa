/**
 * Main entry point for database module
 * Re-exports all domain types and operations for backward compatibility
 */

// Core
export { db, initializeDB, getDB } from "./core/database"
export type { UserSession, UserPreferences, SyncQueueItem, SyncMeta, AircraftCacheEntry } from "./core/core-types"

// Session
export {
  saveUserSession,
  getUserSession,
  clearUserSession,
  getCurrentUserId,
} from "./core/session-store"

// Preferences
export {
  getUserPreferences,
  saveUserPreferences,
  getDefaultFieldOrder,
  addRecentlyUsedAirport,
  getRecentlyUsedAirports,
  addRecentlyUsedAircraft,
  getRecentlyUsedAircraft,
} from "./core/preferences-store"

// Sync Queue
export {
  addToSyncQueue,
  getSyncQueue,
  clearSyncQueueItem,
  getLastSyncTime,
  setLastSyncTime,
  markRecordSynced,
  clearAllUserData,
  clearAllLocalData,
} from "./core/sync-queue-store"

// Flights
export type { FlightLog, Approach, AdditionalCrew } from "./flight/flight-types"
export {
  addFlight,
  updateFlight,
  deleteFlight,
  silentDeleteFlight,
  getAllFlights,
  getFlightById,
  getFlightByMongoId,
  getPendingFlights,
} from "./flight/flight-store"
export { upsertFlightFromServer } from "./flight/flight-sync"

// Aircraft
export type { Aircraft, AircraftData, NormalizedAircraft } from "./aircraft/aircraft-types"
export {
  addAircraft,
  updateAircraft,
  deleteAircraft,
  silentDeleteAircraft,
  getAllAircraft,
  getAircraftById,
} from "./aircraft/aircraft-store"
export { upsertAircraftFromServer } from "./aircraft/aircraft-sync"

// Airports
export type { Airport, AirportData } from "./airport/airport-types"
export {
  getAllAirports,
  getAirportByIcao,
  getAirportByIata,
  getAirportById,
  toggleAirportFavorite,
  getFavoriteAirports,
  bulkLoadAirports,
  addCustomAirport,
} from "./airport/airport-store"
export { getAirportLocalTime, getAirportTimeInfo } from "./airport/airport-utils"

// Personnel
export type { Personnel } from "./personnel/personnel-types"
export {
  addPersonnel,
  updatePersonnel,
  deletePersonnel,
  silentDeletePersonnel,
  getAllPersonnel,
  getPersonnelById,
  getCurrentUserPersonnel,
  getPersonnelByRole,
} from "./personnel/personnel-store"
export { upsertPersonnelFromServer } from "./personnel/personnel-sync"

// Utils
export { generateULID, extractTimestamp } from "./utils/ulid"
export { getFlightStats } from "./utils/stats"
