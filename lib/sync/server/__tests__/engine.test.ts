/**
 * The server sync engine end to end — push, pull and the per-user migration —
 * played as two devices.
 *
 * Runs against an in-memory stand-in for MongoDB by default. Set
 * `SYNC_TEST_MONGO_URI` to a replica set (transactions need one) to run the
 * same suite against a real server:
 *
 *   SYNC_TEST_MONGO_URI="mongodb://127.0.0.1:27017/?replicaSet=rs0" pnpm test lib/sync/server
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { MongoClient, ObjectId, type Db } from "mongodb"
import { applyPush, ensureCanonical, pullChanges, readHeadSeq, type Cursor } from "../engine"
import { validatePushItems, type PushItem } from "../plan"
import { ENVELOPE_KEYS, SYNC_FIELDS, SYNC_SCHEMA_VERSION } from "../../schema"
import type { SyncCollection } from "@/types/sync/sync.types"
import { FakeDb, fakeClient } from "./fake-mongo"

const USER = "user-1"
const REAL_URI = process.env.SYNC_TEST_MONGO_URI
const realClient = REAL_URI ? new MongoClient(REAL_URI) : null

let db: Db
let client: MongoClient

/**
 * The slice of the store the assertions read, whichever backend is in use.
 * `docs` is the raw document list in insertion order.
 */
let fake: {
  collection: (name: string) => {
    docs: Record<string, unknown>[]
    findOne: (q: Record<string, unknown>) => Promise<Record<string, unknown> | null>
  }
}

beforeEach(async () => {
  if (realClient) {
    await realClient.connect()
    client = realClient
    db = realClient.db(`sync_engine_test_${process.pid}`)
    await db.dropDatabase()
    await db.collection("counters").insertOne({ _id: USER as unknown as ObjectId, seq: 0, backfillState: "done" })
    const real = db
    fake = {
      collection: (name) => {
        const coll = real.collection(name)
        // `docs` is synchronous in the fake; for the real server the tests
        // that need it seed through `seedDocs` and read through `allDocs`.
        return {
          get docs(): Record<string, unknown>[] {
            throw new Error("use seedDocs/allDocs against a real server")
          },
          findOne: (q) => coll.findOne(q) as Promise<Record<string, unknown> | null>,
        }
      },
    }
  } else {
    const memory = new FakeDb()
    db = memory as unknown as Db
    client = fakeClient as unknown as MongoClient
    // Legacy serverSeq backfill is a separate, older step — mark it done.
    memory.collection("counters").docs.push({ _id: USER, seq: 0, backfillState: "done" })
    fake = memory as unknown as typeof fake
  }
})

afterAll(async () => {
  if (realClient) {
    await db?.dropDatabase().catch(() => {})
    await realClient.close()
  }
})

async function seedDocs(collection: string, docs: Record<string, unknown>[]) {
  if (realClient) await db.collection(collection).insertMany(docs)
  else fake.collection(collection).docs.push(...docs)
}

async function allDocs(collection: string): Promise<Record<string, unknown>[]> {
  if (realClient) return db.collection(collection).find({}).sort({ _id: 1 }).toArray()
  return fake.collection(collection).docs
}

let q = 0
function op(
  collection: SyncCollection,
  type: PushItem["type"],
  data: Record<string, unknown> & { id: string },
  patch?: { changedFields: string[]; baseSeq: number }
): PushItem {
  return { id: `q${++q}`, type, timestamp: Date.now(), collection, data, ...(patch ?? {}) }
}

async function push(...items: PushItem[]) {
  const { byCollection } = validatePushItems(items)
  return applyPush(client, db, USER, byCollection, "replace")
}

/** A device's view: its cursors, and everything it has pulled. */
function device() {
  const state = {
    cursors: {} as Partial<Record<SyncCollection, Cursor>>,
    tombSeq: 0,
    records: new Map<string, Record<string, unknown>>(),
    deleted: new Set<string>(),
  }
  async function pull(opts: { limit?: number; skip?: Map<string, number> } = {}) {
    let rounds = 0
    for (;;) {
      const res = await pullChanges(db, USER, {
        cursors: state.cursors,
        tombSeq: state.tombSeq,
        limit: opts.limit ?? 500,
        maxBytes: 3_000_000,
        skip: opts.skip,
      })
      for (const [c, change] of Object.entries(res.changes)) {
        for (const r of change!.records) state.records.set(`${c}:${r.id}`, r)
        for (const id of change!.deletions) {
          state.records.delete(`${c}:${id}`)
          state.deleted.add(`${c}:${id}`)
        }
      }
      state.cursors = res.cursors
      state.tombSeq = res.tombSeq
      rounds++
      if (!res.hasMore) return { rounds, headSeq: res.headSeq }
    }
  }
  return { state, pull }
}

describe("two devices", () => {
  it("an edit on one device reaches the other on its next pull", async () => {
    const a = device()
    const b = device()
    await push(op("flights", "create", { id: "f1", date: "2026-10-01", remarks: "first", updatedAt: 100, deviceId: "A" }))

    await b.pull()
    expect(b.state.records.get("flights:f1")?.remarks).toBe("first")

    await push(op("flights", "update", { id: "f1", date: "2026-10-01", remarks: "edited on B", updatedAt: 200, deviceId: "B" }))
    await a.pull()
    expect(a.state.records.get("flights:f1")?.remarks).toBe("edited on B")
  })

  it("an older push loses, and the server hands back the version that won", async () => {
    await push(op("flights", "create", { id: "f1", remarks: "newer", updatedAt: 500, deviceId: "B" }))
    const { results } = await push(op("flights", "update", { id: "f1", remarks: "older", updatedAt: 100, deviceId: "A" }))
    expect(results[0]).toMatchObject({ success: true, stale: true })
    expect(results[0].record?.remarks).toBe("newer")
  })

  it("a purge reaches every device as a deletion, and a late write cannot resurrect it", async () => {
    const b = device()
    await push(op("personnel", "create", { id: "p1", name: "Lim", updatedAt: 1 }))
    await b.pull()
    expect(b.state.records.has("personnel:p1")).toBe(true)

    await push(op("personnel", "delete", { id: "p1" }))
    await b.pull()
    expect(b.state.records.has("personnel:p1")).toBe(false)
    expect(b.state.deleted.has("personnel:p1")).toBe(true)

    const { results } = await push(op("personnel", "update", { id: "p1", name: "Lim", updatedAt: 999 }))
    expect(results[0]).toMatchObject({ success: true, rejected: true })
    expect(await fake.collection("personnel").findOne({ id: "p1" })).toBeNull()
  })

  it("a stale device's purge cannot destroy a record another device has since restored", async () => {
    await push(op("flights", "create", { id: "f1", remarks: "x", updatedAt: 1 }))
    const binned = await push(op("flights", "update", { id: "f1", remarks: "x", deletedAt: 50, updatedAt: 2 }))
    const seenBinnedAt = binned.results[0].serverSeq as number
    // Device A restores it; device C never heard and its 30-day sweep purges.
    await push(op("flights", "update", { id: "f1", remarks: "x", deletedAt: null, updatedAt: 3 }))
    const { results } = await push({ ...op("flights", "delete", { id: "f1" }), baseSeq: seenBinnedAt })
    expect(results[0]).toMatchObject({ success: true, stale: true })
    expect(results[0].record?.id).toBe("f1")
    expect(await fake.collection("flights").findOne({ id: "f1" })).not.toBeNull()

    // Still binned where the purge saw it: the purge applies as ever.
    await push(op("flights", "update", { id: "f1", remarks: "x", deletedAt: 60, updatedAt: 4 }))
    const stored = await fake.collection("flights").findOne({ id: "f1" })
    const purge = await push({ ...op("flights", "delete", { id: "f1" }), baseSeq: stored!.serverSeq as number })
    expect(purge.results[0]).toMatchObject({ success: true })
    expect(purge.results[0].stale).toBeFalsy()
    expect(await fake.collection("flights").findOne({ id: "f1" })).toBeNull()
  })

  it("a comparison purged and then re-imported comes back, on every device", async () => {
    const id = "mismatch:f1:pilotFlying"
    await push(op("discrepancies", "create", { id, holding: "logbook", updatedAt: 1 }))
    await push(op("discrepancies", "delete", { id }))
    const { results } = await push(op("discrepancies", "create", { id, holding: "logbook", updatedAt: 9 }))
    expect(results[0]).toMatchObject({ success: true })
    expect(results[0].rejected).toBeFalsy()

    const fresh = device()
    await fresh.pull()
    expect(fresh.state.records.has(`discrepancies:${id}`)).toBe(true)
    expect(fresh.state.deleted.has(`discrepancies:${id}`)).toBe(false)

    // An imported duty's id is derived too (`importedDutyId`).
    await push(op("scheduleEntries", "create", { id: "duty:2026-10-20:SBY1", updatedAt: 1 }))
    await push(op("scheduleEntries", "delete", { id: "duty:2026-10-20:SBY1" }))
    const duty = await push(op("scheduleEntries", "create", { id: "duty:2026-10-20:SBY1", updatedAt: 9 }))
    expect(duty.results[0].rejected).toBeFalsy()

    // A random-id record keeps the rejection that stops a resurrection.
    await push(op("flights", "create", { id: "f9", updatedAt: 1 }))
    await push(op("flights", "delete", { id: "f9" }))
    const again = await push(op("flights", "create", { id: "f9", updatedAt: 9 }))
    expect(again.results[0]).toMatchObject({ success: true, rejected: true })
  })

  it("a soft delete and a restore both travel as ordinary updates", async () => {
    const b = device()
    await push(op("aircraft", "create", { id: "a1", registration: "9V-TNK", updatedAt: 1 }))
    await push(op("aircraft", "update", { id: "a1", registration: "9V-TNK", deletedAt: 50, updatedAt: 2 }))
    await b.pull()
    expect(b.state.records.get("aircraft:a1")?.deletedAt).toBe(50)

    await push(op("aircraft", "update", { id: "a1", registration: "9V-TNK", deletedAt: null, updatedAt: 3 }))
    await b.pull()
    expect(b.state.records.get("aircraft:a1")).not.toHaveProperty("deletedAt")
  })

  it("a cleared field is cleared on the server, not kept by a merge", async () => {
    await push(op("discrepancies", "create", { id: "d1", resolved: true, resolvedAt: 10, resolvedBy: "ignored", updatedAt: 1 }))
    await push(op("discrepancies", "update", { id: "d1", resolved: false, updatedAt: 2 }))
    const stored = await fake.collection("discrepancies").findOne({ id: "d1" })
    expect(stored?.resolved).toBe(false)
    expect(stored?.resolvedAt).toBeNull()
    expect(stored?.resolvedBy).toBeNull()
  })

  it("the device that pushed does not download its own write back, but its cursor moves past it", async () => {
    const a = device()
    const { written } = await push(op("flights", "create", { id: "f1", updatedAt: 1 }))
    await a.pull({ skip: written })
    expect(a.state.records.size).toBe(0)
    expect(a.state.cursors.flights?.seq).toBeGreaterThan(0)

    await push(op("flights", "create", { id: "f2", updatedAt: 2 }))
    await a.pull()
    expect([...a.state.records.keys()]).toEqual(["flights:f2"])
  })
})

describe("field-level merge — a device that has not caught up", () => {
  async function seed() {
    const { results } = await push(
      op("flights", "create", { id: "f1", remarks: "original", flightNumber: "TR1", outTime: "01:00", updatedAt: 100, deviceId: "A" })
    )
    return results[0].serverSeq!
  }

  it("keeps BOTH devices' edits when they changed different fields", async () => {
    const base = await seed()
    // B (up to date) changes the remarks.
    await push(op("flights", "update", { id: "f1", remarks: "B's remarks", flightNumber: "TR1", outTime: "01:00", updatedAt: 200, deviceId: "B" }, { changedFields: ["remarks"], baseSeq: base }))
    // A never pulled that. It edits the flight number on its OLD copy — which
    // still says "original" for the remarks — and pushes later.
    const { results } = await push(
      op("flights", "update", { id: "f1", remarks: "original", flightNumber: "TR999", outTime: "01:00", updatedAt: 300, deviceId: "A" }, { changedFields: ["flightNumber"], baseSeq: base })
    )

    const stored = await fake.collection("flights").findOne({ id: "f1" })
    expect(stored?.remarks).toBe("B's remarks") // whole-record LWW would have reverted this
    expect(stored?.flightNumber).toBe("TR999")
    // A's copy is behind, so the merged record comes back for it to rebase.
    expect(results[0].record).toMatchObject({ remarks: "B's remarks", flightNumber: "TR999" })
    expect(results[0].record).not.toHaveProperty("fieldVersions")
    expect(results[0].conflicts).toBeUndefined()
  })

  it("settles the SAME field by the later edit and keeps the value that lost", async () => {
    const base = await seed()
    await push(op("flights", "update", { id: "f1", remarks: "B's remarks", updatedAt: 500, deviceId: "B" }, { changedFields: ["remarks"], baseSeq: base }))
    const { results } = await push(
      op("flights", "update", { id: "f1", remarks: "A's older remarks", updatedAt: 300, deviceId: "A" }, { changedFields: ["remarks"], baseSeq: base })
    )

    expect((await fake.collection("flights").findOne({ id: "f1" }))?.remarks).toBe("B's remarks")
    expect(results[0]).toMatchObject({ success: true, stale: true, conflicts: [{ field: "remarks", winner: "server" }] })
    const conflict = await fake.collection("syncConflicts").findOne({ recordId: "f1" })
    expect(conflict).toMatchObject({ field: "remarks", winner: "server", discarded: "A's older remarks", kept: "B's remarks" })
  })

  it("does not move the head for a patch that changed nothing", async () => {
    const base = await seed()
    const before = await readHeadSeq(db, USER)
    await push(op("flights", "update", { id: "f1", remarks: "original", updatedAt: 999, deviceId: "B" }, { changedFields: ["remarks"], baseSeq: base }))
    expect(await readHeadSeq(db, USER)).toBe(before)
  })

  it("records which write last touched each field (server-only bookkeeping)", async () => {
    const base = await seed()
    const { results } = await push(op("flights", "update", { id: "f1", outTime: "02:00", updatedAt: 200, deviceId: "B" }, { changedFields: ["outTime"], baseSeq: base }))
    const stored = await fake.collection("flights").findOne({ id: "f1" })
    expect(stored?.fieldVersions).toEqual({ outTime: { seq: results[0].serverSeq, at: 200, by: "B" } })
  })
})

describe("settings — one record per user, written as patches only", () => {
  // A device writes ONLY the settings the user changed, as an update from
  // base 0 even when it holds no settings row. A fresh device at its defaults
  // therefore states nothing, and two devices' settings merge.
  it("inserts the first patch sparse, merges a second device's, and never writes a default", async () => {
    const first = await push(
      op("settings", "update", { id: "settings", display_timeFormat: "12h", updatedAt: 10, deviceId: "A" }, { changedFields: ["display_timeFormat"], baseSeq: 0 })
    )
    expect(first.results[0]).toMatchObject({ success: true })
    // A NEW device, which has never pulled, changes one other setting.
    await push(
      op("settings", "update", { id: "settings", autoFill_night: false, updatedAt: 20, deviceId: "B" }, { changedFields: ["autoFill_night"], baseSeq: 0 })
    )

    const stored = await fake.collection("settings").findOne({ id: "settings" })
    expect(stored).toMatchObject({ display_timeFormat: "12h", autoFill_night: false })
    // Every other setting is null — unset, so it reads as the default — and
    // nothing the new device did not touch was stated.
    expect(stored!.display_useZuluTime).toBeNull()
    expect(stored!.logging_pfRole).toBeNull()

    const c = device()
    await c.pull()
    const pulled = c.state.records.get("settings:settings")!
    expect(pulled).toMatchObject({ display_timeFormat: "12h", autoFill_night: false })
    expect("display_useZuluTime" in pulled).toBe(false)
  })
})

describe("the seq head", () => {
  it("moves on every write and every deletion — which is what the cheap poll compares", async () => {
    const h0 = await readHeadSeq(db, USER)
    await push(op("flights", "create", { id: "f1", updatedAt: 1 }))
    const h1 = await readHeadSeq(db, USER)
    await push(op("flights", "delete", { id: "f1" }))
    const h2 = await readHeadSeq(db, USER)
    expect(h1).toBeGreaterThan(h0)
    expect(h2).toBeGreaterThan(h1)
  })

  it("does not move for a push the server ignored as stale", async () => {
    await push(op("flights", "create", { id: "f1", updatedAt: 500 }))
    const before = await readHeadSeq(db, USER)
    await push(op("flights", "update", { id: "f1", updatedAt: 100 }))
    expect(await readHeadSeq(db, USER)).toBe(before)
  })
})

describe("paged pull", () => {
  it("delivers every record exactly once across pages and collections", async () => {
    await push(
      op("aircraft", "create", { id: "a1", updatedAt: 1 }),
      op("aircraft", "create", { id: "a2", updatedAt: 1 }),
      op("personnel", "create", { id: "p1", updatedAt: 1 }),
      op("flights", "create", { id: "f1", updatedAt: 1 }),
      op("flights", "create", { id: "f2", updatedAt: 1 }),
      op("flights", "create", { id: "f3", updatedAt: 1 })
    )
    const b = device()
    const { rounds } = await b.pull({ limit: 2 })
    expect(rounds).toBeGreaterThan(2)
    expect([...b.state.records.keys()].sort()).toEqual(
      ["aircraft:a1", "aircraft:a2", "flights:f1", "flights:f2", "flights:f3", "personnel:p1"].sort()
    )
  })
})

describe("migration to the canonical shape", () => {
  it("rewrites legacy documents of different shapes to one key set, without bumping their seq", async () => {
    await seedDocs("flights", [
      { _id: new ObjectId(), userId: USER, id: "old1", date: "2024-01-01", serverSeq: 7, createdAt: 1 },
      {
        _id: new ObjectId(),
        userId: USER,
        id: "old2",
        date: "2025-01-01",
        flightNumber: "TR1",
        remarks: "x",
        signature: { strokes: [] },
        serverSeq: 8,
        createdAt: 2,
        updatedAt: 3,
        syncedAt: 4,
      },
    ])

    expect(await ensureCanonical(client, db, USER)).toBe(true)
    const [a, b] = await allDocs("flights")
    expect(Object.keys(a)).toEqual(Object.keys(b))
    expect(Object.keys(a)).toEqual(["_id", ...ENVELOPE_KEYS, ...Object.keys(SYNC_FIELDS.flights)])
    expect(a.serverSeq).toBe(7)
    expect(b.serverSeq).toBe(8)
    expect(a.schemaVersion).toBe(SYNC_SCHEMA_VERSION)
    expect(b.remarks).toBe("x")
    expect(b.syncedAt).toBe(4)

    const counter = await fake.collection("counters").findOne({ _id: USER })
    expect(counter?.schemaVersion).toBe(SYNC_SCHEMA_VERSION)
  })

  it("sequences legacy tombstones so a device pulling by seq receives them", async () => {
    await seedDocs("deletions", [
      { _id: new ObjectId(), userId: USER, collection: "flights", recordId: "gone", deletedAt: new Date() },
    ])
    await ensureCanonical(client, db, USER)
    const b = device()
    await b.pull()
    expect(b.state.deleted.has("flights:gone")).toBe(true)
  })

  it("works through a large logbook a chunk per request", async () => {
    await seedDocs(
      "flights",
      Array.from({ length: 2500 }, (_, i) => ({ _id: new ObjectId(), userId: USER, id: `f${i}`, serverSeq: i + 1, createdAt: i }))
    )
    let calls = 0
    while (!(await ensureCanonical(client, db, USER))) calls++
    expect(calls).toBeGreaterThanOrEqual(2)
    expect((await allDocs("flights")).every((d) => d.schemaVersion === SYNC_SCHEMA_VERSION)).toBe(true)
  })
})
