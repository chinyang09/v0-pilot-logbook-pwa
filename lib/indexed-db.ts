/**
 * BACKWARD COMPATIBILITY LAYER
 * This file re-exports all database operations from the new /db/ structure
 * to maintain compatibility with existing imports throughout the codebase.
 *
 * New code should import directly from "db" or "db/<domain>/<module>"
 */

// Re-export everything from the new db module
export * from "../db"

// Legacy exports that may have different signatures
export { db, initializeDB, getDB } from "../db/core/database"

// Re-export for legacy imports that reference these directly
export type {
  FlightLog,
  Approach,
  AdditionalCrew,
  Aircraft,
  Airport,
  Personnel,
  UserSession,
  UserPreferences,
  SyncQueueItem,
  SyncMeta,
} from "../db"
