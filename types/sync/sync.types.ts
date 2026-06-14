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
  // Legacy time-based watermark (now used as the wall-clock tombstone watermark).
  lastSyncAt?: number;
  // Generic value slot for sync-engine metadata: device id, per-collection
  // delta cursors, audit counters, etc. Keyed records, no schema change needed.
  value?: unknown;
}

/**
 * Per-collection delta-pull cursor. `seq` is the server-authored monotonic
 * version watermark; `id` is the stringified Mongo `_id` tiebreaker for keyset
 * pagination across records that share a `seq`.
 */
export interface CollectionCursor {
  seq: number;
  id: string;
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
