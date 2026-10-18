/**
 * Client-side pull application and push batching.
 */

import { describe, it, expect } from "vitest"
import { pendingEdits, planLocalApply, takePushBatch, type PendingEdit } from "../batch"
import type { SyncQueueItem } from "@/types/sync/sync.types"

type Rec = { id: string; updatedAt?: number; deviceId?: string; [k: string]: unknown }

describe("planLocalApply", () => {
  const none = new Map<string, PendingEdit>()

  it("writes a record the device does not have", () => {
    const incoming: Rec[] = [{ id: "a", updatedAt: 1 }]
    expect(planLocalApply(incoming, [undefined], none)).toEqual(incoming)
  })

  it("takes the server's copy when nothing is pending — whatever the clocks say", () => {
    // A device whose clock ran fast stamped its last write in the future; the
    // old rule kept that local copy and silently refused every later edit.
    const server: Rec = { id: "a", updatedAt: 100, remarks: "from B" }
    const local: Rec = { id: "a", updatedAt: 9_999_999, remarks: "old" }
    expect(planLocalApply([server], [local], none)).toEqual([server])
  })

  it("rebases a pending FIELD edit onto the server's copy instead of choosing one", () => {
    const server: Rec = { id: "a", updatedAt: 100, remarks: "B's remarks", flightNumber: "TR1", serverSeq: 9 }
    const local: Rec = { id: "a", updatedAt: 50, remarks: "old", flightNumber: "TR2", syncStatus: "pending", serverSeq: 3 }
    const [out] = planLocalApply([server], [local], new Map([["a", { type: "update", fields: ["flightNumber"] }]]))
    expect(out.remarks).toBe("B's remarks") // the other device's edit arrives
    expect(out.flightNumber).toBe("TR2") // this device's unpushed edit survives
    expect(out.syncStatus).toBe("pending")
    expect(out.serverSeq).toBe(9)
  })

  it("does not let a pull erase a dead-lettered (error) local edit that is newer", () => {
    const local: Rec = { id: "a", updatedAt: 9, syncStatus: "error", remarks: "mine" }
    expect(planLocalApply([{ id: "a", updatedAt: 5 }], [local], none)).toEqual([])
    expect(planLocalApply([{ id: "a", updatedAt: 10 }], [local], none)).toHaveLength(1)
  })

  it("does not resurrect a record this device is purging", () => {
    expect(planLocalApply([{ id: "a" }], [{ id: "a" }], new Map([["a", { type: "delete" }]]))).toEqual([])
  })

  it("falls back to last-write-wins for a pending whole-record write", () => {
    const local: Rec = { id: "a", updatedAt: 5 }
    expect(planLocalApply([{ id: "a", updatedAt: 1 }], [local], new Map([["a", { type: "create" }]]))).toEqual([])
  })
})

describe("pendingEdits", () => {
  const row = (p: Partial<SyncQueueItem>): SyncQueueItem =>
    ({ id: Math.random().toString(), type: "update", timestamp: 1, collection: "flights", recordId: "a", data: { id: "a" }, ...p }) as SyncQueueItem

  it("unions the fields of every pending row for a record", () => {
    const map = pendingEdits([row({ changedFields: ["remarks"], timestamp: 1 }), row({ changedFields: ["outTime"], timestamp: 2 })])
    expect(map.get("a")).toEqual({ type: "update", fields: ["outTime", "remarks"] })
  })

  it("treats a create, or a row of unknown fields, as the whole record", () => {
    expect(pendingEdits([row({ type: "create" }), row({ changedFields: ["x"], timestamp: 2 })]).get("a")).toEqual({ type: "create" })
    expect(pendingEdits([row({ changedFields: ["x"] }), row({ timestamp: 2 })]).get("a")).toEqual({ type: "update" })
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
