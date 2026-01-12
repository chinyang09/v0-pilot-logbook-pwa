/**
 * Sync-related type definitions
 */

import type { FlightLog } from "../entities/flight.types";
import type { Aircraft } from "../entities/aircraft.types";
import type { Personnel } from "../entities/crew.types";

export type SyncCollection = "flights" | "aircraft" | "personnel";

export type SyncOperationType = "create" | "update" | "delete";

export interface SyncQueueItem {
  id: string;
  type: SyncOperationType;
  timestamp: number;
  collection: SyncCollection;
  data: FlightLog | Aircraft | Personnel | { id: string };
  retryCount?: number;
}

export interface SyncMeta {
  key: string;
  lastSyncAt: number;
}

export interface SyncResult {
  success: boolean;
  synced: number;
  failed: number;
  errors?: string[];
}

export interface SyncStatus {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncAt: number | null;
  pendingCount: number;
  error?: string;
}
