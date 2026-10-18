/**
 * Pure client-side sync helpers (no IO) — unit-testable in isolation.
 */

import type { SyncQueueItem } from "@/types/sync/sync.types"
import { compareAuthorship, type Authored } from "./authorship"
import { approxBytes } from "./schema"

/**
 * Which pulled records to write locally.
 *
 * A pulled record is applied when the device has no copy, or when it wins (or
 * ties) last-write-wins against the local one. A tie is applied so a re-pull
 * of the same version still repairs a local copy that drifted from it. A
 * LOCALLY newer copy — an edit not yet pushed — is kept, which is what stops a
 * background pull from overwriting what the pilot just typed.
 */
export function selectServerWinners<T extends Authored>(incoming: T[], existing: (T | undefined)[]): T[] {
  const winners: T[] = []
  incoming.forEach((record, i) => {
    const local = existing[i]
    if (!local || compareAuthorship(record, local) >= 0) winners.push(record)
  })
  return winners
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
