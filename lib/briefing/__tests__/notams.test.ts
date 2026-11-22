/**
 * The NOTAM register: a flag follows what a NOTAM SAYS through a re-issue and
 * new dates; "new" is what a briefing brought that no earlier one did; what
 * the pilot has not flagged stays available, folded away.
 */

import { describe, it, expect } from "vitest"
import { expiredRecords, groupNotams, notamCounts, registerChanges, statusOf, NOTAM_KEEP_AFTER_MS } from "../notams"
import { notamKey } from "../parse"
import { notamRecordId } from "../ids"
import type { Notam } from "../types"
import type { NotamRecord } from "@/types/entities/briefing.types"

const notam = (id: string, location: string, text: string, extra: Partial<Notam> = {}): Notam => ({
  key: notamKey(location, text),
  id,
  location,
  locationName: location,
  section: "Destination Airport",
  category: "AIRPORT",
  fromMs: Date.UTC(2026, 10, 1),
  toMs: Date.UTC(2026, 11, 31),
  toText: "31-DEC-26 2359",
  schedule: "",
  limits: "",
  text,
  duplicate: false,
  ...extra,
})

const NOW = Date.UTC(2026, 10, 22, 12)

function applyCreates(changes: ReturnType<typeof registerChanges>): Map<string, NotamRecord> {
  return new Map(changes.create.map((c) => [c.id, { ...c, createdAt: NOW } as NotamRecord]))
}

describe("an import into the register", () => {
  const s2 = notam("1A3350/26", "WSSS", "TWY S2 CLSD")
  const w9 = notam("1A3351/26", "WSSS", "TWY W9 CLSD")

  it("creates a record for each NOTAM never seen, once however many copies the bulletin carries", () => {
    const dupe = notam("1A9999/26", "WSSS", "TWY S2 CLSD")
    const c = registerChanges([s2, w9, dupe], new Map(), "brief:438:2026-11-22:WSSS", NOW)
    expect(c.create.map((r) => r.notamId)).toEqual(["1A3350/26", "1A3351/26"])
    expect(c.create.every((r) => !r.flagged && r.firstBriefingId === "brief:438:2026-11-22:WSSS")).toBe(true)
    expect(c.update).toEqual([])
  })

  it("keeps the flag through a re-issue under a new number and new dates, and writes only what moved", () => {
    const reg = applyCreates(registerChanges([s2], new Map(), "brief:a", NOW))
    reg.get(notamRecordId(s2.key))!.flagged = true
    const reissued = notam("1A4100/26", "WSSS", "TWY S2 CLSD", { toMs: Date.UTC(2027, 0, 31), toText: "31-JAN-27 2359" })
    const c = registerChanges([reissued], reg, "brief:b", NOW + 3_600_000)
    expect(c.create).toEqual([])
    expect(c.update).toEqual([{ id: notamRecordId(s2.key), patch: { notamId: "1A4100/26", toMs: Date.UTC(2027, 0, 31), toText: "31-JAN-27 2359" } }])
    expect(c.update[0].patch).not.toHaveProperty("flagged")
    expect(statusOf(reissued, reg, "brief:b")).toBe("flagged")
  })

  it("writes nothing when the same briefing is opened again", () => {
    const reg = applyCreates(registerChanges([s2, w9], new Map(), "brief:a", NOW))
    expect(registerChanges([s2, w9], reg, "brief:a", NOW + 60_000)).toEqual({ create: [], update: [] })
  })
})

describe("a briefing's NOTAMs", () => {
  const a = notam("1", "WBGG", "D-ATIS LIVE OPR TRIAL")
  const b = notam("2", "WBGG", "TWY C CLSD")
  const c = notam("3", "WBGG", "CRANE 120FT")
  const reg = applyCreates(registerChanges([a, b], new Map(), "brief:first", NOW))
  reg.get(notamRecordId(a.key))!.flagged = true

  it("are flagged, new (first came with THIS briefing, or never imported) or known", () => {
    expect(statusOf(a, reg, "brief:later")).toBe("flagged")
    expect(statusOf(b, reg, "brief:later")).toBe("known")
    expect(statusOf(b, reg, "brief:first")).toBe("new")
    expect(statusOf(c, reg, "brief:later")).toBe("new")
  })

  it("group by location, a NOTAM's copies folded into one with every number", () => {
    const copy = notam("4", "WBGG", "D-ATIS LIVE OPR TRIAL")
    const groups = groupNotams([a, b, c, copy], reg, "brief:later")
    expect(groups).toHaveLength(1)
    expect(groups[0].flagged.map((v) => v.ids)).toEqual([["1", "4"]])
    expect(groups[0].fresh.map((v) => v.notam.id)).toEqual(["3"])
    expect(groups[0].known.map((v) => v.notam.id)).toEqual(["2"])
    expect(notamCounts(groups)).toEqual({ flagged: 1, new: 1, known: 1, total: 3 })
  })

  it("leave the register a week after their validity ends — a PERM one never", () => {
    const old = { ...reg.get(notamRecordId(b.key))!, toMs: NOW - NOTAM_KEEP_AFTER_MS - 1 }
    const perm = { ...reg.get(notamRecordId(a.key))!, toMs: null }
    expect(expiredRecords([old, perm], NOW).map((r) => r.id)).toEqual([old.id])
  })
})
