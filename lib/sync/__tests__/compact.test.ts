/**
 * Tests for sync-queue compaction — multiple ops per record collapse to one.
 */

import { describe, it, expect } from "vitest"
import { compactSyncQueue } from "../compact"
import type { SyncQueueItem, SyncOperationType } from "@/types/sync/sync.types"

function op(
  type: SyncOperationType,
  id: string,
  timestamp: number,
  data: Record<string, unknown> = {}
): SyncQueueItem {
  return {
    id: `q-${id}-${timestamp}`,
    type,
    timestamp,
    collection: "flights",
    recordId: id,
    data: { id, ...data },
  }
}

describe("compactSyncQueue", () => {
  it("collapses repeated updates into a single update with the latest data", () => {
    const out = compactSyncQueue([
      op("update", "a", 1, { v: 1 }),
      op("update", "a", 2, { v: 2 }),
      op("update", "a", 3, { v: 3 }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe("update")
    expect((out[0].data as unknown as { v: number }).v).toBe(3)
  })

  it("keeps a create sticky even after later updates", () => {
    const out = compactSyncQueue([
      op("create", "a", 1, { v: 1 }),
      op("update", "a", 2, { v: 2 }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe("create")
    expect((out[0].data as unknown as { v: number }).v).toBe(2)
  })

  it("drops a record created and deleted before ever syncing", () => {
    const out = compactSyncQueue([
      op("create", "a", 1),
      op("update", "a", 2),
      op("delete", "a", 3),
    ])
    expect(out).toHaveLength(0)
  })

  it("keeps a delete for a record that was already synced (no pending create)", () => {
    const out = compactSyncQueue([op("update", "a", 1), op("delete", "a", 2)])
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe("delete")
  })

  it("orders by timestamp regardless of array order", () => {
    const out = compactSyncQueue([
      op("update", "a", 3, { v: 3 }),
      op("update", "a", 1, { v: 1 }),
      op("update", "a", 2, { v: 2 }),
    ])
    expect((out[0].data as unknown as { v: number }).v).toBe(3)
  })

  it("keeps separate records separate", () => {
    const out = compactSyncQueue([
      op("create", "a", 1),
      op("update", "b", 2),
      op("delete", "c", 3),
    ])
    expect(out).toHaveLength(3)
  })
})
