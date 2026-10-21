/**
 * The canonical server document shape — every document in a collection has
 * the same keys, in the same order, whatever the client sent.
 */

import { describe, it, expect } from "vitest"
import {
  ENVELOPE_KEYS,
  SYNC_COLLECTIONS,
  SYNC_FIELDS,
  SYNC_SCHEMA_VERSION,
  buildEnvelope,
  canonicalizeDocument,
  toWireRecord,
  writeMode,
  writeSource,
} from "../schema"
import type { SyncCollection } from "@/types/sync/sync.types"

const NOW = 1_760_000_000_000

function write(
  collection: SyncCollection,
  incoming: Record<string, unknown>,
  existing?: Record<string, unknown>,
  mode = writeMode(SYNC_SCHEMA_VERSION)
) {
  const id = incoming.id as string
  const envelope = buildEnvelope({ id, userId: "u1", incoming, existing, serverSeq: 42, now: NOW })
  return canonicalizeDocument(collection, writeSource(collection, mode, incoming, existing), envelope)
}

describe("canonical document shape", () => {
  it("gives two very different flights exactly the same keys in the same order", () => {
    const sparse = write("flights", { id: "a", date: "2026-10-01", updatedAt: 1 })
    const rich = write("flights", {
      id: "b",
      date: "2026-10-02",
      flightNumber: "TR216",
      signature: { strokes: [], capturedAt: 1 },
      importDecisions: { pilotFlying: { declined: "false", at: 1 } },
      entryType: "flight",
      remarks: "gusty",
      syncStatus: "pending",
      updatedAt: 2,
    })
    expect(Object.keys(sparse)).toEqual(Object.keys(rich))
  })

  it("says one thing one way: a flight's type and lock are never null (v3)", () => {
    // Production held entryType on 14 flights and null on 307, isLocked as
    // false on 250 and null on 71 — three spellings of "an ordinary flight".
    const legacy = write("flights", { id: "a", isSimulator: null, entryType: null, isLocked: null })
    expect([legacy.entryType, legacy.isSimulator, legacy.isLocked]).toEqual(["flight", false, false])
    const oldSim = write("flights", { id: "b", isSimulator: true })
    expect([oldSim.entryType, oldSim.isSimulator]).toEqual(["simulator", true])
    const newSim = write("flights", { id: "c", entryType: "simulator" })
    expect([newSim.entryType, newSim.isSimulator]).toEqual(["simulator", true])
    const locked = write("flights", { id: "d", isLocked: true })
    expect(locked.isLocked).toBe(true)
  })

  it("drops a RETIRED key and keeps an unknown one", () => {
    const doc = write("flights", { id: "a", isDraft: false, someNewerField: 1 })
    expect("isDraft" in doc).toBe(false)
    expect(doc.someNewerField).toBe(1)
    // Also on a replace over a stored document that still has it.
    const over = write("flights", { id: "a" }, { id: "a", isDraft: false, createdAt: 1 })
    expect("isDraft" in over).toBe(false)
  })

  it("gives every crew card the dated PF convention", () => {
    const card = write("personnel", { id: "p", name: "Self" })
    expect(card.pfRole).toBeNull()
    expect(card.pfRoleFrom).toBeNull()
    expect([card.isMe, card.favorite, card.defaultPIC, card.defaultSIC]).toEqual([false, false, false, false])
    expect(write("personnel", { id: "q", isMe: true, defaultSIC: true }).defaultSIC).toBe(true)
  })

  it("starts every collection with the same envelope", () => {
    for (const collection of SYNC_COLLECTIONS) {
      const doc = write(collection, { id: "x" })
      expect(Object.keys(doc).slice(0, ENVELOPE_KEYS.length)).toEqual([...ENVELOPE_KEYS])
      expect(doc.schemaVersion).toBe(SYNC_SCHEMA_VERSION)
    }
  })

  it("lists every payload field after the envelope, filling defaults for missing ones", () => {
    const doc = write("currencies", { id: "c", code: "MEDICAL" })
    expect(Object.keys(doc).slice(ENVELOPE_KEYS.length)).toEqual(Object.keys(SYNC_FIELDS.currencies))
    expect(doc.code).toBe("MEDICAL")
    expect(doc.warningDays).toBe(30)
    expect(doc.criticalDays).toBe(7)
    expect(doc.notes).toBeNull()
  })

  it("never stores device-local bookkeeping", () => {
    const doc = write("flights", { id: "a", syncStatus: "pending", _id: "spoof" })
    expect(doc).not.toHaveProperty("syncStatus")
    expect(doc).not.toHaveProperty("_id")
  })

  it("does not share a mutable default between documents", () => {
    const a = write("flights", { id: "a" })
    const b = write("flights", { id: "b" })
    expect(a.approaches).toEqual([])
    expect(a.approaches).not.toBe(b.approaches)
  })

  it("derives a schedule entry's importedAt from its createdAt", () => {
    const doc = write("scheduleEntries", { id: "s", createdAt: 123 })
    expect(doc.importedAt).toBe(123)
  })

  it("keeps a field the table does not know, after the known ones", () => {
    const doc = write("aircraft", { id: "a", registration: "9V-TNK", futureField: "keep me" })
    expect(doc.futureField).toBe("keep me")
    expect(Object.keys(doc).at(-1)).toBe("futureField")
  })
})

describe("envelope", () => {
  it("keeps the stored createdAt — a client cannot move when a record was created", () => {
    const doc = write("flights", { id: "a", createdAt: 999, updatedAt: 1000 }, { id: "a", createdAt: 5 })
    expect(doc.createdAt).toBe(5)
    expect(doc.updatedAt).toBe(1000)
  })

  it("coerces string timestamps and writes deletedAt as null when cleared", () => {
    const doc = write("flights", { id: "a", createdAt: "100", updatedAt: "200", deletedAt: null })
    expect(doc.createdAt).toBe(100)
    expect(doc.updatedAt).toBe(200)
    expect(doc.deletedAt).toBeNull()
  })

  it("is assigned by the server: userId, serverSeq and syncedAt cannot be spoofed", () => {
    const doc = write("flights", { id: "a", userId: "someone-else", serverSeq: 1, syncedAt: 1 })
    expect(doc.userId).toBe("u1")
    expect(doc.serverSeq).toBe(42)
    expect(doc.syncedAt).toBe(NOW)
  })
})

describe("write modes", () => {
  const stored = write("discrepancies", {
    id: "d",
    resolved: true,
    resolvedAt: 50,
    resolvedBy: "ignored",
    legacyKey: "old",
  })

  it("REPLACE (current client): an omitted field is cleared — what `$set` never could do", () => {
    // unresolveDiscrepancy sends the entity with resolvedAt/resolvedBy undefined,
    // which JSON drops. They must not survive on the server.
    const doc = write("discrepancies", { id: "d", resolved: false, updatedAt: 99 }, stored, "replace")
    expect(doc.resolved).toBe(false)
    expect(doc.resolvedAt).toBeNull()
    expect(doc.resolvedBy).toBeNull()
  })

  it("REPLACE still keeps keys outside the schema that only the stored doc has", () => {
    const doc = write("discrepancies", { id: "d", resolved: false }, stored, "replace")
    expect(doc.legacyKey).toBe("old")
  })

  it("MERGE (older client): an omitted field keeps its stored value", () => {
    const doc = write("discrepancies", { id: "d", resolved: false }, stored, "merge")
    expect(doc.resolved).toBe(false)
    expect(doc.resolvedAt).toBe(50)
    expect(doc.resolvedBy).toBe("ignored")
  })

  it("chooses replace only for a client on the current schema", () => {
    expect(writeMode(SYNC_SCHEMA_VERSION)).toBe("replace")
    expect(writeMode(SYNC_SCHEMA_VERSION + 1)).toBe("replace")
    expect(writeMode(SYNC_SCHEMA_VERSION - 1)).toBe("merge")
    expect(writeMode(undefined)).toBe("merge")
    expect(writeMode("2")).toBe("merge")
  })
})

describe("toWireRecord", () => {
  it("removes nulls and server-only keys, so a client sees the shape it always has", () => {
    const doc = { _id: "oid", ...write("flights", { id: "a", date: "2026-10-01", deletedAt: null }) }
    const wire = toWireRecord(doc)
    expect(wire).not.toHaveProperty("_id")
    expect(wire).not.toHaveProperty("syncedAt")
    expect(wire).not.toHaveProperty("schemaVersion")
    expect(wire).not.toHaveProperty("deletedAt")
    expect(wire).not.toHaveProperty("signature")
    expect(wire.syncStatus).toBe("synced")
    expect(wire.serverSeq).toBe(42)
    expect(wire.blockTime).toBe("00:00")
  })

  it("keeps a real deletedAt stamp", () => {
    const wire = toWireRecord(write("personnel", { id: "p", deletedAt: 1234 }))
    expect(wire.deletedAt).toBe(1234)
  })
})
