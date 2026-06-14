/**
 * Pure sync-queue compaction (no IO) — unit-testable in isolation.
 */

import type { SyncQueueItem } from "@/types/sync/sync.types"

/**
 * Compact a sync queue by merging multiple operations on the same record into
 * one:
 * - create (+ later updates) → a single "create" with the latest data
 * - update (+ later updates) → a single "update" with the latest data
 * - create … delete (never synced) → dropped entirely (nothing to send)
 * - update … delete → a single "delete"
 */
export function compactSyncQueue(queue: SyncQueueItem[]): SyncQueueItem[] {
  const recordOps = new Map<string, SyncQueueItem[]>()
  for (const item of queue) {
    const recordId = (item.data as { id?: string })?.id
    if (!recordId) continue
    const key = `${item.collection}:${recordId}`
    if (!recordOps.has(key)) recordOps.set(key, [])
    recordOps.get(key)!.push(item)
  }

  const compacted: SyncQueueItem[] = []
  for (const operations of recordOps.values()) {
    operations.sort((a, b) => a.timestamp - b.timestamp)
    const latest = operations[operations.length - 1]

    if (latest.type === "delete") {
      // Created and deleted before ever syncing → nothing to send.
      if (operations.some((op) => op.type === "create")) continue
      compacted.push(latest)
      continue
    }

    const finalType = operations.some((op) => op.type === "create") ? "create" : latest.type
    compacted.push({ ...latest, type: finalType })
  }
  return compacted
}
