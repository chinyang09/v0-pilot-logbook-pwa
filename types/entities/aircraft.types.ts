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
  deletedAt?: number;
  syncStatus: SyncStatus;
}

export type AircraftCreate = Omit<Aircraft, "id" | "createdAt" | "syncStatus">;
export type AircraftUpdate = Partial<Aircraft>;

/**
 * Reference aircraft data from CDN (read-only, no sync)
 */
export interface AircraftReference {
  registration: string;
  data: string; // JSON string with aircraft details
}

/**
 * Unified aircraft reference record
 * Used for CDN data, FR24 lookups, and custom entries
 */
export interface AircraftRecord {
  registration: string; // "9V-TNK" — canonical registration
  icao24: string; // "76D1CB" — ICAO 24-bit hex address
  typecode: string; // "A20N" — ICAO type designator (lookup in aircraft-types.json for full info)
  operator?: string; // "TGW" — operator/owner code
  source?: "cdn" | "fr24" | "custom"; // Data provenance
  submissionId?: string; // Links to MongoDB submission for reconciliation
}
