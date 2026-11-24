import { describe, expect, it } from "vitest"
import { byTightness, limitDetails } from "../limit-detail"
import { calculateRollingStats } from "@/lib/utils/roster/fdp-calculator"
import { DEFAULT_FTL_LIMITS, type DutyPeriod } from "@/types/entities/roster.types"

const duty = (id: string, date: string, dutyMinutes: number, flightMinutes: number, over: Partial<DutyPeriod> = {}): DutyPeriod =>
  ({ id, date, dutyMinutes, flightMinutes, route: `R-${id}`, flightIds: [], ...over }) as unknown as DutyPeriod

const asOf = Date.parse("2026-11-24T09:00:00Z")
const past = [
  duty("a", "2026-11-11", 600, 400), // 14 days ago: just inside a 14-day window ending 24 Nov
  duty("b", "2026-11-18", 540, 360),
  duty("c", "2026-11-20", 300, 0, { dutyKind: "standby", countedDutyMinutes: 144 }),
  duty("d", "2026-11-23", 480, 300),
  duty("old", "2026-10-01", 700, 500), // outside 14 and 28, inside 365
]

describe("limitDetails", () => {
  const all = [...past, duty("n", "2026-11-26", 420, 280, { isFuture: true }), duty("m", "2026-11-28", 600, 400, { isFuture: true })]
  const d = limitDetails(past, all, asOf, all.find((x) => x.id === "n")!)
  const by = Object.fromEntries(d.map((x) => [x.id, x]))

  it("counts what the limits bars count", () => {
    for (const [id, days, field] of [["duty-14", 14, "dutyHours"], ["duty-28", 28, "dutyHours"], ["flight-28", 28, "flightHours"], ["flight-365", 365, "flightHours"]] as const) {
      const s = calculateRollingStats(past, new Date(asOf), days, DEFAULT_FTL_LIMITS)
      expect(by[id].usedMinutes).toBe(Math.round(s[field] * 60))
    }
    // A home standby counts its 20%.
    expect(by["duty-14"].usedMinutes).toBe(600 + 540 + 144 + 480)
    expect(by["duty-14"].remainingMinutes).toBe(90 * 60 - by["duty-14"].usedMinutes)
  })

  it("lists the duties in the window, the largest first", () => {
    expect(by["duty-14"].contributors.map((c) => c.id)).toEqual(["a", "b", "d", "c"])
    // Flight time: the standby adds none.
    expect(by["flight-28"].contributors.map((c) => c.id)).toEqual(["a", "b", "d"])
    expect(by["flight-365"].contributors.map((c) => c.id)).toContain("old")
  })

  it("rolls the oldest day out at 00:00Z the window's length after it", () => {
    expect(by["duty-14"].rollOff).toEqual({ atMs: Date.parse("2026-11-25T00:00:00Z"), date: "2026-11-11", minutes: 600 })
    expect(by["flight-365"].rollOff?.date).toBe("2026-10-01")
  })

  it("says what the next duty adds and what it leaves, the roster before it counted", () => {
    // 26 Nov's 14-day window: 13 Nov – 26 Nov → b, c, d and n (a has rolled out).
    expect(by["duty-14"].next).toEqual({ minutes: 420, leavesMinutes: 90 * 60 - (540 + 144 + 480 + 420) })
  })

  it("finds the tightest day ahead", () => {
    // 28 Nov's 28-day window holds everything since 1 Nov, both duties ahead too.
    expect(by["duty-28"].tightestAhead).toEqual({ leftMinutes: 180 * 60 - (600 + 540 + 144 + 480 + 420 + 600), date: "2026-11-28" })
  })

  it("orders the tightest first", () => {
    expect(byTightness(d)[0].fraction).toBeGreaterThanOrEqual(byTightness(d)[1].fraction)
  })

  it("has no next impact for a duty already counted", () => {
    const again = limitDetails(past, all, asOf, past[3])
    expect(again.every((x) => x.next === null)).toBe(true)
  })
})
