/**
 * Pure halves of the server sync engine — no MongoDB import, so they are
 * unit-testable on their own. `engine.ts` does the IO around them.
 */

import type { SyncCollection } from "@/types/sync/sync.types"
import { compareAuthorship } from "../authorship"
import { isSyncCollection } from "../schema"

export interface PushItem {
  id: string
  type: "create" | "update" | "delete"
  timestamp: number
  collection: SyncCollection
  data: Record<string, unknown> & { id: string }
  retryCount?: number
}

export interface PushItemResult {
  queueItemId: string
  success: boolean
  /** The record was purged on another device — delete it locally. */
  rejected?: boolean
  /** The server already holds a NEWER version; `record` carries it. */
  stale?: boolean
  record?: Record<string, unknown>
  reason?: string
}

const MAX_ID_LENGTH = 200

/**
 * Validate and bucket a pushed batch by collection. An invalid item is poison:
 * reported as a failure (the client dead-letters it after its retries) rather
 * than silently dropped.
 */
export function validatePushItems(raw: unknown[]): {
  byCollection: Map<SyncCollection, PushItem[]>
  invalid: PushItemResult[]
} {
  const byCollection = new Map<SyncCollection, PushItem[]>()
  const invalid: PushItemResult[] = []
  for (const item of raw as Partial<PushItem>[]) {
    const data = item?.data as { id?: unknown } | undefined
    const ok =
      !!item &&
      typeof item.id === "string" &&
      (item.type === "create" || item.type === "update" || item.type === "delete") &&
      isSyncCollection(item.collection) &&
      !!data &&
      typeof data === "object" &&
      typeof data.id === "string" &&
      data.id.length > 0 &&
      data.id.length <= MAX_ID_LENGTH
    if (!ok) {
      invalid.push({
        queueItemId: typeof item?.id === "string" ? item.id : "unknown",
        success: false,
        reason: "Invalid sync item",
      })
      continue
    }
    const list = byCollection.get(item.collection as SyncCollection) ?? []
    list.push(item as PushItem)
    byCollection.set(item.collection as SyncCollection, list)
  }
  return { byCollection, invalid }
}

export type PushDecision = "insert" | "update" | "delete" | "stale" | "rejected"

/**
 * What to do with one pushed item, given what the server holds.
 *
 * - a delete always applies (tombstone first, then the record)
 * - a write for a TOMBSTONED id is rejected — it was purged elsewhere, and
 *   re-creating it would resurrect it on every device
 * - otherwise last-write-wins by (updatedAt, deviceId); an equal or older
 *   version is `stale`, and the server's copy goes back to the client
 */
export function decidePush(
  item: PushItem,
  existing: Record<string, unknown> | undefined,
  tombstoned: boolean
): PushDecision {
  if (item.type === "delete") return "delete"
  if (tombstoned) return "rejected"
  if (!existing) return "insert"
  return compareAuthorship(item.data as never, existing as never) > 0 ? "update" : "stale"
}

/**
 * If a batch carries more than one item for the same record (it shouldn't —
 * the client compacts — but a hand-rolled or older client might), keep only
 * the LAST, and report the earlier ones as succeeded without writing them.
 * Two writes to one document in one bulkWrite would otherwise race on the
 * same seq block.
 */
export function dedupeByRecord(items: PushItem[]): { kept: PushItem[]; superseded: PushItem[] } {
  const lastIndex = new Map<string, number>()
  items.forEach((item, i) => lastIndex.set(item.data.id, i))
  const kept: PushItem[] = []
  const superseded: PushItem[] = []
  items.forEach((item, i) => (lastIndex.get(item.data.id) === i ? kept : superseded).push(item))
  return { kept, superseded }
}

/** Key for "this request wrote this record at this seq". */
export const writtenKey = (collection: SyncCollection, id: string) => `${collection}:${id}`
