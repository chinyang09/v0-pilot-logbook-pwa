/**
 * Field-level change tracking — what an edit changed, how collapsed edits
 * combine, and how the server applies one onto a record another device has
 * moved on.
 */

import { describe, expect, it } from "vitest"
import { diffFields, earlierBase, rebaseOnServer, sameValue, unionFields } from "../changes"
import { applyFieldPatch } from "../server/plan"
import { compactSyncQueue } from "../compact"
import type { SyncQueueItem } from "@/types/sync/sync.types"

describe("diffFields", () => {
  it("lists the fields whose value moved, ignoring bookkeeping", () => {
    expect(
      diffFields(
        { id: "a", remarks: "x", outTime: "01:00", updatedAt: 1, deviceId: "A", syncStatus: "synced", serverSeq: 3 },
        { id: "a", remarks: "y", outTime: "01:00", updatedAt: 2, deviceId: "B", syncStatus: "pending", serverSeq: 4 }
      )
    ).toEqual(["remarks"])
  })

  it("treats null, undefined and absent as the same 'no value'", () => {
    expect(diffFields({ deletedAt: null }, {})).toEqual([])
    expect(diffFields({ deletedAt: 5 }, { deletedAt: null })).toEqual(["deletedAt"])
  })

  it("compares nested values deeply and ignores key order", () => {
    expect(sameValue({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true)
    expect(diffFields({ manualOverrides: { nightTime: true } }, { manualOverrides: { nightTime: false } })).toEqual([
      "manualOverrides",
    ])
  })
})

describe("collapsing edits", () => {
  it("unions field sets, and an unknown set means the whole record", () => {
    expect(unionFields(["b"], ["a", "b"])).toEqual(["a", "b"])
    expect(unionFields(["a"], undefined)).toBeUndefined()
  })

  it("keeps the EARLIEST base", () => {
    expect(earlierBase(7, 3)).toBe(3)
    expect(earlierBase(undefined, 3)).toBe(3)
  })

  it("compaction carries the union and the earliest base into the push", () => {
    const row = (p: Partial<SyncQueueItem>): SyncQueueItem =>
      ({ id: `q${p.timestamp}`, type: "update", collection: "flights", recordId: "f", data: { id: "f" }, ...p }) as SyncQueueItem
    const [out] = compactSyncQueue([
      row({ timestamp: 1, changedFields: ["remarks"], baseSeq: 4 }),
      row({ timestamp: 2, changedFields: ["outTime"], baseSeq: 9 }),
    ])
    expect(out.changedFields).toEqual(["outTime", "remarks"])
    expect(out.baseSeq).toBe(4)
  })

  it("a create stays a whole-record write however many edits follow it", () => {
    const [out] = compactSyncQueue([
      { id: "1", type: "create", timestamp: 1, collection: "flights", data: { id: "f" } },
      { id: "2", type: "update", timestamp: 2, collection: "flights", data: { id: "f" }, changedFields: ["remarks"] },
    ] as SyncQueueItem[])
    expect(out.type).toBe("create")
    expect(out.changedFields).toBeUndefined()
  })
})

describe("rebaseOnServer", () => {
  it("lays the local pending fields over the server's record", () => {
    const out = rebaseOnServer(
      { id: "a", remarks: "server", outTime: "02:00", updatedAt: 9, serverSeq: 12 },
      { id: "a", remarks: "local", outTime: "01:00", updatedAt: 5, deviceId: "B", syncStatus: "pending" },
      ["remarks"]
    )
    expect(out).toMatchObject({ remarks: "local", outTime: "02:00", serverSeq: 12, updatedAt: 5, deviceId: "B" })
  })

  it("clears a field the local edit cleared", () => {
    const out = rebaseOnServer({ id: "a", deletedAt: 5 }, { id: "a" }, ["deletedAt"])
    expect(out).not.toHaveProperty("deletedAt")
  })
})

describe("applyFieldPatch — the server side", () => {
  const stored = {
    id: "f",
    remarks: "B's remarks",
    flightNumber: "TR1",
    outTime: "01:00",
    fieldVersions: { remarks: { seq: 10, at: 1000, by: "B" } },
  }

  it("a STALE device's edit to one field leaves every other field alone", () => {
    // A last saw seq 5. Since then B changed the remarks. A edits flightNumber
    // on its old copy, whose remarks are still the old ones.
    const { doc, applied, conflicts, concurrent } = applyFieldPatch({
      existing: stored,
      incoming: { id: "f", remarks: "old remarks", flightNumber: "TR2", outTime: "01:00" },
      fields: ["flightNumber"],
      baseSeq: 5,
      deviceId: "A",
      editedAt: 2000,
      seq: 11,
    })
    expect(doc.remarks).toBe("B's remarks")
    expect(doc.flightNumber).toBe("TR2")
    expect(applied).toEqual(["flightNumber"])
    expect(conflicts).toEqual([])
    expect(concurrent).toBe(true)
  })

  it("the same field edited on two devices is a conflict, and the later edit wins", () => {
    const later = applyFieldPatch({
      existing: stored,
      incoming: { id: "f", remarks: "A's remarks" },
      fields: ["remarks"],
      baseSeq: 5,
      deviceId: "A",
      editedAt: 2000,
      seq: 11,
    })
    expect(later.doc.remarks).toBe("A's remarks")
    expect(later.conflicts[0]).toMatchObject({ field: "remarks", winner: "incoming", discarded: "B's remarks" })

    const earlier = applyFieldPatch({
      existing: stored,
      incoming: { id: "f", remarks: "A's remarks" },
      fields: ["remarks"],
      baseSeq: 5,
      deviceId: "A",
      editedAt: 500,
      seq: 11,
    })
    expect(earlier.doc.remarks).toBe("B's remarks")
    expect(earlier.applied).toEqual([])
    expect(earlier.conflicts[0]).toMatchObject({ winner: "server", discarded: "A's remarks" })
  })

  it("is not a conflict when both devices arrived at the same value", () => {
    const r = applyFieldPatch({
      existing: stored,
      incoming: { id: "f", remarks: "B's remarks" },
      fields: ["remarks"],
      baseSeq: 5,
      deviceId: "A",
      editedAt: 2000,
      seq: 11,
    })
    expect(r.conflicts).toEqual([])
    expect(r.applied).toEqual([])
  })

  it("does not treat a device's own earlier write as a conflict", () => {
    const r = applyFieldPatch({
      existing: stored,
      incoming: { id: "f", remarks: "B again" },
      fields: ["remarks"],
      baseSeq: 5,
      deviceId: "B",
      editedAt: 100, // even with an older clock reading
      seq: 11,
    })
    expect(r.conflicts).toEqual([])
    expect(r.doc.remarks).toBe("B again")
  })

  it("refuses to patch identity and bookkeeping", () => {
    const r = applyFieldPatch({
      existing: stored,
      incoming: { id: "other", userId: "someone-else", serverSeq: 1 },
      fields: ["id", "userId", "serverSeq", "fieldVersions"],
      baseSeq: 0,
      deviceId: "A",
      editedAt: 1,
      seq: 2,
    })
    expect(r.applied).toEqual([])
    expect(r.doc.id).toBe("f")
  })
})
