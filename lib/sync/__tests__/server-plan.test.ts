/**
 * The pure halves of the server engine: what to do with each pushed item, and
 * the cursor/retention helpers the pull uses.
 */

import { describe, it, expect } from "vitest"
import { MAX_CLOCK_LEAD_MS, decidePush, dedupeByRecord, editTime, validatePushItems, type PushItem } from "../server/plan"
import { keysetQuery, needsFullResync, sanitizeCursor, TOMBSTONE_RETENTION_MS } from "../server/engine"

function item(p: Omit<Partial<PushItem>, "data"> & { data?: Record<string, unknown> } = {}): PushItem {
  return {
    id: "q1",
    type: "update",
    timestamp: 1,
    collection: "flights",
    ...p,
    data: { id: "f1", ...(p.data ?? {}) },
  } as PushItem
}

describe("decidePush", () => {
  it("inserts a record the server has never seen", () => {
    expect(decidePush(item({ data: { updatedAt: 5 } }), undefined, false)).toBe("insert")
  })

  it("updates when the push is newer", () => {
    expect(decidePush(item({ data: { updatedAt: 10 } }), { updatedAt: 5 }, false)).toBe("update")
  })

  it("is stale when the server already holds a newer or identical version", () => {
    expect(decidePush(item({ data: { updatedAt: 5 } }), { updatedAt: 10 }, false)).toBe("stale")
    expect(decidePush(item({ data: { updatedAt: 5, deviceId: "a" } }), { updatedAt: 5, deviceId: "a" }, false)).toBe(
      "stale"
    )
  })

  it("breaks a timestamp tie by device id, the same way the client does", () => {
    expect(decidePush(item({ data: { updatedAt: 5, deviceId: "b" } }), { updatedAt: 5, deviceId: "a" }, false)).toBe(
      "update"
    )
  })

  it("refuses a purge of a record restored since the purging device saw it binned", () => {
    const del = (baseSeq?: number) => item({ type: "delete", ...(baseSeq !== undefined ? { baseSeq } : {}) })
    expect(decidePush(del(5), { deletedAt: null, serverSeq: 9 }, false)).toBe("stale")
    expect(decidePush(del(5), { deletedAt: 40, serverSeq: 9 }, false)).toBe("delete")
    expect(decidePush(del(9), { deletedAt: null, serverSeq: 9 }, false)).toBe("delete")
    // An older build sends no base: unchanged behaviour.
    expect(decidePush(del(), { deletedAt: null, serverSeq: 9 }, false)).toBe("delete")
  })

  it("rejects a write to a purged (tombstoned) record instead of resurrecting it", () => {
    expect(decidePush(item({ data: { updatedAt: 99 } }), undefined, true)).toBe("rejected")
  })

  it("always applies a delete", () => {
    expect(decidePush(item({ type: "delete" }), { updatedAt: 99 }, true)).toBe("delete")
  })
})

describe("decidePush — field patches", () => {
  it("is a patch when an update says which fields it changed", () => {
    expect(decidePush(item({ changedFields: ["remarks"], data: { updatedAt: 1 } }), { updatedAt: 99 }, false)).toBe("patch")
  })
  it("is still an insert when the server has no such record", () => {
    expect(decidePush(item({ changedFields: ["remarks"] }), undefined, false)).toBe("insert")
  })
})

describe("editTime", () => {
  it("caps a device clock running ahead of the server, so it can't win every conflict", () => {
    const now = 1_000_000
    expect(editTime(item({ data: { updatedAt: now - 10 } }), now)).toBe(now - 10)
    expect(editTime(item({ data: { updatedAt: now + 3_600_000 } }), now)).toBe(now + MAX_CLOCK_LEAD_MS)
  })
})

describe("validatePushItems", () => {
  it("buckets valid items by collection and reports the rest as failures", () => {
    const { byCollection, invalid } = validatePushItems([
      item({ id: "ok-1" }),
      item({ id: "ok-2", collection: "aircraft" }),
      { id: "bad-collection", type: "update", collection: "users", data: { id: "x" } },
      { id: "bad-type", type: "upsert", collection: "flights", data: { id: "x" } },
      { id: "no-record-id", type: "update", collection: "flights", data: {} },
      null,
      { id: "bad-fields", type: "update", collection: "flights", data: { id: "x" }, changedFields: "remarks" },
      { id: "bad-base", type: "update", collection: "flights", data: { id: "x" }, baseSeq: -1 },
    ])
    expect(byCollection.get("flights")?.map((i) => i.id)).toEqual(["ok-1"])
    expect(byCollection.get("aircraft")?.map((i) => i.id)).toEqual(["ok-2"])
    expect(invalid.map((r) => r.queueItemId)).toEqual([
      "bad-collection",
      "bad-type",
      "no-record-id",
      "unknown",
      "bad-fields",
      "bad-base",
    ])
    expect(invalid.every((r) => r.success === false)).toBe(true)
  })
})

describe("dedupeByRecord", () => {
  it("keeps the last item per record and reports the earlier ones separately", () => {
    const { kept, superseded } = dedupeByRecord([
      item({ id: "q1", data: { id: "a" } }),
      item({ id: "q2", data: { id: "b" } }),
      item({ id: "q3", data: { id: "a" } }),
    ])
    expect(kept.map((i) => i.id)).toEqual(["q2", "q3"])
    expect(superseded.map((i) => i.id)).toEqual(["q1"])
  })
})

describe("pull cursor helpers", () => {
  it("sanitizes a hostile or malformed cursor to the start", () => {
    expect(sanitizeCursor(undefined)).toEqual({ seq: 0, id: "" })
    expect(sanitizeCursor({ seq: -4, id: "not-an-objectid" })).toEqual({ seq: 0, id: "" })
    expect(sanitizeCursor({ seq: Number.NaN })).toEqual({ seq: 0, id: "" })
    expect(sanitizeCursor({ seq: 7, id: "507f1f77bcf86cd799439011" })).toEqual({
      seq: 7,
      id: "507f1f77bcf86cd799439011",
    })
  })

  it("queries everything for a fresh cursor, and strictly after it otherwise", () => {
    expect(keysetQuery("u", { seq: 0, id: "" })).toEqual({ userId: "u" })
    expect(keysetQuery("u", { seq: 5, id: "" })).toEqual({ userId: "u", $or: [{ serverSeq: { $gt: 5 } }] })
    const withId = keysetQuery("u", { seq: 5, id: "507f1f77bcf86cd799439011" }) as { $or: unknown[] }
    expect(withId.$or).toHaveLength(2)
  })

  it("asks for a full resync only past tombstone retention", () => {
    const now = 10 * TOMBSTONE_RETENTION_MS
    expect(needsFullResync(0, now)).toBe(false)
    expect(needsFullResync(now - 1000, now)).toBe(false)
    expect(needsFullResync(now - TOMBSTONE_RETENTION_MS - 1, now)).toBe(true)
  })
})
