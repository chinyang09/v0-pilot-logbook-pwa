/**
 * Aircraft-related type definitions
 */

import type { SyncStatus } from "./flight.types";

export type EngineType = "SEP" | "MEP" | "SET" | "MET" | "JET";

/**
 * User-owned aircraft (syncs with MongoDB)
 */
export interface Aircraft {
  id: string;
  userId?: string;
  registration: string;
  type: string;
  typeDesignator: string;
  model: string;
  category: string;
  engineType: EngineType;
  isComplex: boolean;
  isHighPerformance: boolean;
  createdAt: number;
  updatedAt?: number;
  /** Soft-delete stamp — the row is in Recently Deleted. `null` when cleared,
   *  never undefined (see SyncableEntity). */
  deletedAt?: number | null;
  syncStatus: SyncStatus;
  // Sync engine: server-authored monotonic version (delta cursor) + authoring device (LWW tiebreak)
  serverSeq?: number;
  deviceId?: string;
}

export type AircraftCreate = Omit<Aircraft, "id" | "createdAt" | "syncStatus">;
export type AircraftUpdate = Partial<Aircraft>;

/**
 * Reference aircraft data stored in IndexedDB (synced from MongoDB)
 */
export interface AircraftReference {
  registration: string;
  data: string; // JSON string with aircraft details
  /**
   * Soft-delete stamp — the entry is in Recently Deleted.
   *
   * Local only: `referenceDb` has no sync queue, so a removed custom aircraft
   * is removed on this device. That is what deleting one has always meant; the
   * change here is only that it is recoverable for 30 days first.
   */
  deletedAt?: number | null;
}

/**
 * Unified aircraft reference record
 * Used for MongoDB-synced data, FR24 lookups, and custom entries
 */
export interface AircraftRecord {
  registration: string; // "9V-TNK" — canonical registration
  icao24: string; // "76D1CB" — ICAO 24-bit hex address
  typecode: string; // "A20N" — ICAO type designator
  operator?: string; // "TGW" — operator/owner code
  shortDescription?: string; // "L2J" — ICAO DOC 8643 description code
  wtc?: string; // "M" — Wake Turbulence Category
  wtg?: string; // "D" — Wake Turbulence Group
  manufacturerCode?: string; // "AIRBUS" — ICAO manufacturer code
  source?: "fr24" | "custom"; // Data provenance
  submissionId?: string; // Links to MongoDB submission for reconciliation
}
