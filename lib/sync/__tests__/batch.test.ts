/**
 * Client-side pull application and push batching.
 */

import { describe, it, expect } from "vitest"
import { selectServerWinners, takePushBatch } from "../batch"
import type { SyncQueueItem } from "@/types/sync/sync.types"

describe("selectServerWinners", () => {
  it("writes a record the device does not have", () => {
    const incoming = [{ id: "a", updatedAt: 1 }]
    expect(selectServerWinners(incoming, [undefined])).toEqual(incoming)
  })

  it("keeps a LOCALLY newer copy — an edit not yet pushed survives a background pull", () => {
    const winners = selectServerWinners([{ id: "a", updatedAt: 1 }], [{ id: "a", updatedAt: 5 }])
    expect(winners).toEqual([])
  })

  it("applies a newer server version and re-applies an identical one (repairs drift)", () => {
    const newer = { id: "a", updatedAt: 9, deviceId: "x" }
    const same = { id: "b", updatedAt: 3, deviceId: "x" }
    const winners = selectServerWinners([newer, same], [
      { id: "a", updatedAt: 1, deviceId: "x" },
      { id: "b", updatedAt: 3, deviceId: "x" },
    ])
    expect(winners).toEqual([newer, same])
  })
})

function queued(id: string, payloadBytes: number): SyncQueueItem {
  return {
    id: `q-${id}`,
    type: "update",
    timestamp: 1,
    collection: "flights",
    recordId: id,
    data: { id, remarks: "x".repeat(payloadBytes) } as never,
  }
}

describe("takePushBatch", () => {
  it("stops at the item cap", () => {
    const items = Array.from({ length: 10 }, (_, i) => queued(`r${i}`, 10))
    expect(takePushBatch(items, { maxItems: 3, maxBytes: 1e9 })).toHaveLength(3)
  })

  it("stops before exceeding the byte budget", () => {
    const items = [queued("a", 400), queued("b", 400), queued("c", 400)]
    const batch = takePushBatch(items, { maxItems: 100, maxBytes: 1400 })
    expect(batch.map((i) => i.recordId)).toEqual(["a", "b"])
  })

  it("always takes at least one item, so an oversized record cannot stall the queue", () => {
    const batch = takePushBatch([queued("huge", 100_000), queued("small", 1)], { maxItems: 100, maxBytes: 1000 })
    expect(batch.map((i) => i.recordId)).toEqual(["huge"])
  })
})
