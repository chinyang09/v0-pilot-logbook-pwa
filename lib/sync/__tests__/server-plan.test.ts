/**
 * The pure halves of the server engine: what to do with each pushed item, and
 * the cursor/retention helpers the pull uses.
 */

import { describe, it, expect } from "vitest"
import { decidePush, dedupeByRecord, validatePushItems, type PushItem } from "../server/plan"
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

  it("rejects a write to a purged (tombstoned) record instead of resurrecting it", () => {
    expect(decidePush(item({ data: { updatedAt: 99 } }), undefined, true)).toBe("rejected")
  })

  it("always applies a delete", () => {
    expect(decidePush(item({ type: "delete" }), { updatedAt: 99 }, true)).toBe("delete")
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
    ])
    expect(byCollection.get("flights")?.map((i) => i.id)).toEqual(["ok-1"])
    expect(byCollection.get("aircraft")?.map((i) => i.id)).toEqual(["ok-2"])
    expect(invalid.map((r) => r.queueItemId)).toEqual(["bad-collection", "bad-type", "no-record-id", "unknown"])
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
