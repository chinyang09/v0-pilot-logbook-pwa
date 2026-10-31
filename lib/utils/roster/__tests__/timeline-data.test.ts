/**
 * generateTimelineData reads its rolling 14/28/365-day sums off a sorted
 * index. It used to call calculateRollingStats three times per DAY over every
 * duty period — ~40s at a 4× CPU throttle on a long logbook, in the
 * dashboard's first render. This pins the index to that original definition:
 * same windows, same bounds, same order of summation.
 */

import { describe, it, expect } from "vitest"
import { calculateRollingStats, generateTimelineData } from "../fdp-calculator"
import type { DutyPeriod, FTLLimits } from "@/types/entities/roster.types"

const LIMITS = { maxDuty14Days: 90, maxDuty28Days: 180, maxFlight28Days: 100, maxFlight365Days: 1000 } as FTLLimits

/** The rolling sums exactly as generateTimelineData used to compute them. */
function referenceRolling(dutyPeriods: DutyPeriod[]) {
  const sorted = [...dutyPeriods].sort((a, b) => a.date.localeCompare(b.date))
  const today = new Date().toISOString().split("T")[0]
  const last = sorted[sorted.length - 1].date
  const end = last > today ? last : today
  const out: number[][] = []
  for (let day = sorted[0].date; day <= end; ) {
    const asOf = new Date(day + "T23:59:59Z")
    const upTo = sorted.filter((d) => d.date <= day)
    const s14 = calculateRollingStats(upTo, asOf, 14, LIMITS)
    const s28 = calculateRollingStats(upTo, asOf, 28, LIMITS)
    const s365 = calculateRollingStats(upTo, asOf, 365, LIMITS)
    const n = Math.max(1, sorted.filter((d) => d.date === day).length)
    for (let i = 0; i < n; i++) out.push([s14.dutyHours, s28.dutyHours, s28.flightHours, s365.flightHours])
    const d = new Date(day + "T00:00:00Z")
    d.setUTCDate(d.getUTCDate() + 1)
    day = d.toISOString().split("T")[0]
  }
  return out
}

function duty(date: string, dutyMinutes: number, flightMinutes: number, counted?: number): DutyPeriod {
  return { id: `${date}-${Math.random()}`, date, dutyMinutes, flightMinutes, countedDutyMinutes: counted } as DutyPeriod
}

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
}

describe("generateTimelineData — rolling sums", () => {
  it("matches calculateRollingStats over every day, on random rosters", () => {
    for (let round = 0; round < 25; round++) {
      const rand = seeded(round + 1)
      const start = Date.UTC(2025, Math.floor(rand() * 12), 1 + Math.floor(rand() * 28))
      const dps: DutyPeriod[] = []
      const count = 1 + Math.floor(rand() * 60)
      for (let i = 0; i < count; i++) {
        const date = new Date(start + Math.floor(rand() * 500) * 86_400_000).toISOString().slice(0, 10)
        // Standby carries a fractional counted share — summation order matters there.
        const counted = rand() < 0.2 ? Math.round(rand() * 600) * 0.2 : undefined
        dps.push(duty(date, Math.floor(rand() * 800), Math.floor(rand() * 600), counted))
      }
      const got = generateTimelineData(dps, LIMITS).map((p) => [
        p.rolling14DayDuty,
        p.rolling28DayDuty,
        p.rolling28DayFlight,
        p.rolling365DayFlight,
      ])
      expect(got).toEqual(referenceRolling(dps))
    }
  })

  it("walks every calendar day, across month, year and leap-day boundaries", () => {
    const points = generateTimelineData([duty("2023-12-30", 60, 30), duty("2024-03-02", 60, 30)], LIMITS)
    const days = points.map((p) => p.date)
    const expected: string[] = []
    for (let d = new Date("2023-12-30T00:00:00Z"); expected.length < days.length; d.setUTCDate(d.getUTCDate() + 1)) {
      expected.push(d.toISOString().split("T")[0])
    }
    expect(days).toEqual(expected)
    expect(days).toContain("2024-02-29")
    expect(days).toContain("2024-01-01")
  })

  it("labels each day without the locale formatter", () => {
    const points = generateTimelineData([duty("2026-04-04", 60, 30), duty("2026-12-31", 60, 30)], LIMITS)
    expect(points[0].dateLabel).toBe("04 Apr")
    expect(points.find((p) => p.date === "2026-12-31")?.dateLabel).toBe("31 Dec")
  })
})

/**
 * The windows are whole UTC days, the clock a duty's `date` is keyed on. They
 * compared each duty's LOCAL midnight against UTC as-of instants, so in
 * Singapore every 14/28/365-day window lost its oldest day — a duty 13 days
 * back was dropped from the 14-day total, which under-states the limit.
 * Node re-reads `process.env.TZ`, so each zone is exercised in this process.
 */
describe("rolling windows are the same in every time zone", () => {
  const ZONES = ["UTC", "Asia/Singapore", "Asia/Kolkata", "America/New_York", "Pacific/Kiritimati", "Pacific/Pago_Pago"]
  const saved = process.env.TZ
  const dps = [duty("2026-08-01", 600, 300), duty("2026-07-31", 120, 60), duty("2026-08-14", 60, 30)]

  for (const zone of ZONES) {
    it(`counts the 14 days ending on the as-of day in ${zone}`, () => {
      process.env.TZ = zone
      try {
        // 1 Aug is the 14th day back from 14 Aug (inclusive); 31 Jul is the 15th.
        expect(calculateRollingStats(dps, new Date("2026-08-14T23:59:59Z"), 14, LIMITS).dutyHours).toBe(11)
        expect(calculateRollingStats(dps, new Date("2026-08-14T00:00:00Z"), 14, LIMITS).dutyHours).toBe(11)
        expect(calculateRollingStats(dps, new Date("2026-08-14T23:59:59Z"), 28, LIMITS).dutyHours).toBe(13)
        const point = generateTimelineData(dps, LIMITS).find((p) => p.date === "2026-08-14")
        expect(point?.rolling14DayDuty).toBe(11)
        expect(point?.rolling28DayFlight).toBe(6.5)
        // A duty dated the day AFTER the as-of day is never in the window.
        expect(calculateRollingStats(dps, new Date("2026-07-31T23:59:59Z"), 14, LIMITS).dutyHours).toBe(2)
      } finally {
        process.env.TZ = saved
      }
    })
  }
})
