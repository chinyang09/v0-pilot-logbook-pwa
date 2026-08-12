/**
 * Database exports
 *
 * This module provides access to both databases:
 * - userDb: User-specific data (cleared on logout)
 * - referenceDb: Reference data (persists across sessions)
 */

export { userDb, initializeUserDB } from "./user-db";
export { referenceDb, initializeReferenceDB } from "./reference-db";

// Re-export types
export type {
  FlightLog,
  FlightLogCreate,
  Approach,
  AdditionalCrew,
  SyncStatus,
  SignaturePoint,
  SignatureStroke,
  SignatureBounds,
  SignerRole,
  FlightSignature,
} from "@/types/entities/flight.types";
export type {
  Aircraft,
  AircraftCreate,
  AircraftReference,
  AircraftRecord,
} from "@/types/entities/aircraft.types";
export type { Airport } from "@/types/entities/airport.types";
export type {
  AircraftTypeRaw,
  AircraftType,
} from "@/types/entities/aircraft-type.types";
export type { Personnel, PersonnelCreate } from "@/types/entities/crew.types";
export type { UserSession } from "@/types/entities/user.types";
export type { UserPreferences, DisplayPreferences, AutoFillPreferences, DutyTimeDefaults, NavigationPreferences, BottomNavTab, ThemePreference } from "@/types/db/stores.types";
export { DEFAULT_DISPLAY_PREFERENCES, DEFAULT_AUTO_FILL_PREFERENCES, DEFAULT_DUTY_TIME_DEFAULTS, DEFAULT_NAVIGATION_PREFERENCES, DEFAULT_IMPORT_DEFAULTS } from "@/types/db/stores.types";
export type { SyncQueueItem, SyncMeta } from "@/types/sync/sync.types";
export type {
  ScheduleEntry,
  ScheduleEntryCreate,
  Currency,
  CurrencyCreate,
  CurrencyWithStatus,
  CurrencyStatus,
  Discrepancy,
  DiscrepancyCreate,
  DiscrepancyType,
  DutyType,
  TimeReference,
  ScheduledSector,
  ScheduledCrewMember,
  ScheduleImportResult,
} from "@/types/entities/roster.types";

// Re-export user stores
export {
  addFlight,
  updateFlight,
  deleteFlight,
  restoreFlight,
  permanentlyDeleteFlight,
  purgeExpiredDeletedFlights,
  getDeletedFlights,
  isLiveFlight,
  silentDeleteFlight,
  getAllFlights,
  getFlightById,
  getPendingFlights,
  upsertFlightFromServer,
  markFlightSynced,
} from "./stores/user/flights.store";

export {
  addAircraft,
  updateAircraft,
  deleteAircraft,
  restoreAircraft,
  permanentlyDeleteAircraft,
  purgeExpiredDeletedAircraft,
  getDeletedAircraft,
  silentDeleteAircraft,
  getAllAircraft,
  getAircraftById,
  upsertAircraftFromServer,
} from "./stores/user/aircraft.store";

export {
  addPersonnel,
  updatePersonnel,
  deletePersonnel,
  restorePersonnel,
  permanentlyDeletePersonnel,
  purgeExpiredDeletedPersonnel,
  getDeletedPersonnel,
  silentDeletePersonnel,
  getAllPersonnel,
  getPersonnelById,
  getCurrentUserPersonnel,
  getPersonnelByRole,
  upsertPersonnelFromServer,
} from "./stores/user/crew.store";

export {
  saveUserSession,
  getUserSession,
  clearUserSession,
  getCurrentUserId,
} from "./stores/user/sessions.store";

export {
  getUserPreferences,
  saveUserPreferences,
  getDefaultFieldOrder,
  addRecentlyUsedAirport,
  getRecentlyUsedAirports,
  addRecentlyUsedAircraft,
  getRecentlyUsedAircraft,
  toggleFavoriteAircraft,
  getFavoriteAircraft,
  getDraftGenerationConfig,
  saveDraftGenerationConfig,
} from "./stores/user/preferences.store";

export {
  addToSyncQueue,
  getSyncQueue,
  getSyncQueueCount,
  getSyncQueueByCollection,
  clearSyncQueueItem,
  clearSyncQueueByCollection,
  incrementRetryCount,
  getLastSyncTime,
  setLastSyncTime,
  markRecordSynced,
  enqueueMany,
  getDeviceId,
  getMetaValue,
  setMetaValue,
  getCollectionCursor,
  setCollectionCursor,
  resetAllCollectionCursors,
  bumpSyncAudit,
  getSyncAudit,
  reconcilePushedRecords,
} from "./stores/user/sync-queue.store";

// Re-export roster stores - schedule entries
export {
  addScheduleEntry,
  updateScheduleEntry,
  deleteScheduleEntry,
  getAllScheduleEntries,
  getScheduleEntryById,
  getScheduleEntriesByDateRange,
  getScheduleEntriesByDate,
  getScheduleEntriesByDutyType,
  getFlightScheduleEntries,
  getUnlinkedFlightEntries,
  linkFlightsToScheduleEntry,
  bulkUpsertScheduleEntries,
  clearAllScheduleEntries,
  getScheduleEntriesCount,
  getScheduleDateRange,
  silentDeleteScheduleEntry,
  upsertScheduleEntryFromServer,
} from "./stores/user/schedule.store";

// Re-export roster stores - currencies
export {
  getCurrencyStatus,
  addCurrency,
  updateCurrency,
  deleteCurrency,
  restoreCurrency,
  permanentlyDeleteCurrency,
  purgeExpiredDeletedCurrency,
  getDeletedCurrency,
  getAllCurrencies,
  getAllCurrenciesWithStatus,
  getCurrencyById,
  getCurrencyByCode,
  getExpiringCurrencies,
  getExpiredCurrencies,
  getCurrenciesSortedByExpiry,
  upsertCurrency,
  bulkUpsertCurrencies,
  clearAllCurrencies,
  getCurrenciesCount,
  silentDeleteCurrency,
  upsertCurrencyFromServer,
} from "./stores/user/currencies.store";

// Re-export roster stores - discrepancies
export {
  addDiscrepancy,
  bulkAddDiscrepancies,
  getDiscrepancyById,
  resolveDiscrepancy,
  unresolveDiscrepancy,
  setDiscrepancyHolding,
  purgeExpiredAcceptedDiscrepancies,
  getAllDiscrepancies,
  getUnresolvedDiscrepancies,
  getResolvedDiscrepancies,
  getDiscrepanciesByType,
  getDiscrepanciesByScheduleEntry,
  getDiscrepanciesByFlightLog,
  deleteDiscrepancy,
  clearAllDiscrepancies,
  getDiscrepanciesCount,
  getDiscrepanciesBySeverity,
  silentDeleteDiscrepancy,
  upsertDiscrepancyFromServer,
} from "./stores/user/discrepancies.store";

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
  hasExactAirportCodeMatch,
  getAirportTimeInfo,
  formatAirport,
  getAirportsRevision,
  getAirportByICAO,
  getAirportByIATA,
  type AirportData,
} from "./stores/reference/airports.store";

// Re-export reference stores - aircraft database
export {
  // Types
  type NormalizedAircraft,
  // Search
  searchAircraftFromDB,
  getAircraftByRegistrationFromDB,
  getAircraftByIcao24FromDB,
  batchGetAircraftByRegistrations,
  // Helpers
  normalizeAircraft,
  formatAircraft,
  // CRUD
  addAircraftToDatabase,
  getAircraftFromDatabase,
  deleteAircraftFromDatabase,
  restoreAircraftInDatabase,
  permanentlyDeleteAircraftFromDatabase,
  purgeExpiredDeletedAircraftReferences,
  getDeletedAircraftReferences,
  getAllAircraftFromDatabase,
  hasAircraftInDatabase,
  // Custom entries & sync
  addCustomAircraftToDatabase,
  bulkUpsertAircraftReferences,
  clearAircraftCache,
} from "./stores/reference/aircraft.store";

// Re-export reference stores - aircraft types
export {
  loadAircraftTypes,
  getAircraftType,
  getAircraftTypeRaw,
  searchAircraftTypes,
  getAllAircraftTypes,
  clearAircraftTypesCache,
} from "./stores/reference/aircraft-types.store";

// Re-export metadata stores
export {
  getFlightStats,
  type FlightStats,
} from "./stores/metadata/stats.store";

// Import userDb for clearAllUserData
import { userDb } from "./user-db";

/**
 * Clear all user data (called on logout)
 */
export async function clearAllUserData(): Promise<void> {
  await userDb.clearAllUserData();
}

/**
 * Initialize both databases
 */
export async function initializeDB(): Promise<boolean> {
  const { initializeUserDB } = await import("./user-db");
  const { initializeReferenceDB } = await import("./reference-db");

  const [userReady, refReady] = await Promise.all([
    initializeUserDB(),
    initializeReferenceDB(),
  ]);

  return userReady && refReady;
}
