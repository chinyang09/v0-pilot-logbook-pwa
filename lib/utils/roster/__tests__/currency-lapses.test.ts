import { describe, expect, it } from "vitest"
import { currencyFindings, currencyLapses, lapseOf } from "../currency-lapses"
import type { DutyBlock } from "../duty-timeline"
import type { Currency } from "@/types/entities/roster.types"

const cur = (o: Partial<Currency>): Currency =>
  ({ id: "med", code: "MED", description: "Medical", expiryDate: "2026-11-21", warningDays: 30, criticalDays: 7, autoUpdate: false, createdAt: 0, syncStatus: "synced", ...o }) as Currency

const block = (id: string, startIso: string, sector: Record<string, unknown> = {}): DutyBlock =>
  ({
    id,
    kind: "flight",
    startMs: Date.parse(startIso),
    endMs: Date.parse(startIso) + 6 * 3_600_000,
    route: "WSSS-WIII-WSSS",
    sectors: [{ id: `${id}-s`, flightNumber: `TR${id}`, positioning: false, simulator: false, ...sector }],
  }) as unknown as DutyBlock

describe("currencies on the FDP page", () => {
  it("lapses at 00:00 Singapore the day after the last valid day", () => {
    expect(new Date(lapseOf("2026-11-21")!).toISOString()).toBe("2026-11-21T16:00:00.000Z")
  })

  const now = Date.parse("2026-11-18T10:00:00Z")

  it("flags the first duty that flies on an expired document — and only that one", () => {
    const blocks = [block("274", "2026-11-18T22:55:00Z"), block("438", "2026-11-22T21:30:00Z"), block("552", "2026-11-25T00:00:00Z")]
    expect(currencyFindings([cur({})], blocks, now)).toEqual([
      { key: "cur-med", atMs: Date.parse("2026-11-22T21:30:00Z"), severity: "violation", text: "TR438 after Medical expires", source: "Medical" },
    ])
  })

  it("leaves a duty on the last valid day alone, and a simulator session — it may be the renewal", () => {
    const blocks = [block("274", "2026-11-21T15:00:00Z"), block("sim", "2026-11-23T00:00:00Z", { simulator: true })]
    expect(currencyFindings([cur({})], blocks, now)).toEqual([
      { key: "cur-med", atMs: lapseOf("2026-11-21")!, severity: "caution", text: "Medical expires", source: "Medical" },
    ])
  })

  it("says nothing of a document outside its warning window, or binned", () => {
    expect(currencyFindings([cur({ expiryDate: "2027-06-01" }), cur({ id: "x", deletedAt: 1 })], [], now)).toEqual([])
  })

  it("lists the lapses soonest first", () => {
    expect(currencyLapses([cur({ id: "a", expiryDate: "2027-01-01" }), cur({ id: "b" })]).map((l) => l.id)).toEqual(["b", "a"])
  })
})
