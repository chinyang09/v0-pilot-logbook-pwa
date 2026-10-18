/**
 * Sync-related type definitions
 */

import type { FlightLog } from "../entities/flight.types";
import type { Aircraft } from "../entities/aircraft.types";
import type { Personnel } from "../entities/crew.types";
import type { ScheduleEntry, Currency, Discrepancy } from "../entities/roster.types";

export type SyncCollection =
  | "flights"
  | "aircraft"
  | "personnel"
  | "scheduleEntries"
  | "currencies"
  | "discrepancies";

export type SyncOperationType = "create" | "update" | "delete";

export interface SyncQueueItem {
  id: string;
  type: SyncOperationType;
  timestamp: number;
  collection: SyncCollection;
  // Underlying record id, denormalized onto the queue row so a [collection+
  // recordId] index can dedup at enqueue time (one live row per record).
  recordId?: string;
  data: FlightLog | Aircraft | Personnel | ScheduleEntry | Currency | Discrepancy | { id: string };
  retryCount?: number;
  /**
   * The fields this row changes (union across the edits collapsed into it).
   * Absent means the WHOLE record — a create, or a write whose fields are not
   * known — which the server falls back to last-write-wins for. See
   * `lib/sync/changes.ts` for why an edit is a patch and not a record.
   */
  changedFields?: string[];
  /** The record's `serverSeq` when the first collapsed edit was made. */
  baseSeq?: number;
}

/** What an enqueue call knows about the edit, beyond the record itself. */
export interface SyncChangeMeta {
  changedFields?: string[];
  baseSeq?: number;
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
