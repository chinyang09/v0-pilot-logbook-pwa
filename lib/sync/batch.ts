/**
 * Pure client-side sync helpers (no IO) — unit-testable in isolation.
 */

import type { SyncQueueItem } from "@/types/sync/sync.types"
import { compareAuthorship, type Authored } from "./authorship"
import { rebaseOnServer, unionFields } from "./changes"
import { approxBytes } from "./schema"

/** What this device still has waiting to push for one record. */
export interface PendingEdit {
  type: "create" | "update" | "delete"
  /** Fields the pending edit changes; absent = the whole record. */
  fields?: string[]
}

/**
 * What to write locally for each pulled record — the server's copy, rebased
 * under anything this device has not pushed yet.
 *
 * | local state | result |
 * |---|---|
 * | no local copy, or nothing pending | the server's record, whatever the clocks say |
 * | a dead-lettered local edit (`error`) | last-write-wins — it is unsynced work with no queue row |
 * | a pending FIELD edit | the server's record with those fields laid over it |
 * | a pending whole-record write (a create) | last-write-wins, as before |
 * | a pending purge | nothing — don't resurrect what this device just deleted |
 *
 * No clock is consulted in the common cases. The record came off the server's
 * monotonic cursor, so it is newer than anything this device last saw; the
 * only thing it can be "older" than is an edit still in this device's queue,
 * and that edit is exactly the set of fields to keep.
 */
export function planLocalApply<T extends Authored & Record<string, unknown>>(
  incoming: T[],
  existing: (T | undefined)[],
  pending: Map<string, PendingEdit>
): T[] {
  const out: T[] = []
  incoming.forEach((record, i) => {
    const local = existing[i]
    const edit = pending.get(record.id as string)
    if (edit?.type === "delete") return
    if (!local) {
      out.push(record)
      return
    }
    if (!edit) {
      // A dead-lettered edit has no queue row any more, but it is still the
      // pilot's unsynced work — don't let the next pull erase it silently.
      if (local.syncStatus === "error" && compareAuthorship(record, local) < 0) return
      out.push(record)
      return
    }
    if (edit.fields) {
      out.push(rebaseOnServer(record, local, edit.fields))
      return
    }
    if (compareAuthorship(record, local) >= 0) out.push(record)
  })
  return out
}

/** Fold a collection's queue rows into one pending edit per record. */
export function pendingEdits(rows: SyncQueueItem[]): Map<string, PendingEdit> {
  const map = new Map<string, PendingEdit>()
  const sorted = [...rows].sort((a, b) => a.timestamp - b.timestamp)
  for (const row of sorted) {
    const id = row.recordId ?? (row.data as { id?: string }).id
    if (!id) continue
    const prev = map.get(id)
    if (row.type === "delete") {
      map.set(id, { type: "delete" })
      continue
    }
    const type = prev?.type === "create" || row.type === "create" ? "create" : "update"
    const fields =
      type === "create" ? undefined : prev && prev.type !== "delete" ? unionFields(prev.fields, row.changedFields) : row.changedFields
    map.set(id, fields ? { type, fields } : { type })
  }
  return map
}

export interface PushBatchLimits {
  maxItems: number
  maxBytes: number
}

/**
 * The next slice of the (compacted) queue to push, bounded by count AND by
 * serialized size. A flight carrying a signature is tens of kilobytes, so a
 * count alone can build a request over the platform's body limit; the
 * keepalive flush on page hide is capped at 64KB by the browser.
 *
 * Always takes at least one item, so an oversized record still gets its turn
 * (and its own failure) instead of stalling the queue behind it.
 */
export function takePushBatch(items: SyncQueueItem[], limits: PushBatchLimits): SyncQueueItem[] {
  const batch: SyncQueueItem[] = []
  let bytes = 0
  for (const item of items) {
    if (batch.length >= limits.maxItems) break
    const size = approxBytes(item)
    if (batch.length > 0 && bytes + size > limits.maxBytes) break
    batch.push(item)
    bytes += size
  }
  return batch
}

/** Queue key for "this record in this collection". */
export const recordKey = (item: SyncQueueItem) => `${item.collection}:${(item.data as { id: string }).id}`
