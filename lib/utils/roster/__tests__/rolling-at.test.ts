/**
 * The rolling limits at an instant: equal to the pipeline's day figure once
 * every duty in the window has ended, a duty in progress counted only as far
 * as it has gone, and a date leaving the window at midnight.
 */
import { describe, expect, it } from "vitest"
import { buildDutyTimeline, pointerState } from "../duty-timeline"
import { createRollingIndex, rollingAt, rollingSeries } from "../rolling-at"
import { calculateRollingStats } from "../fdp-calculator"
import { DEFAULT_FTL_LIMITS, type DutyPeriod } from "@/types/entities/roster.types"
import type { FlightLog } from "@/types/entities/flight.types"

const H = 3_600_000
const MIN = 60_000
const at = (iso: string) => Date.parse(iso)

function duty(over: Partial<DutyPeriod>): DutyPeriod {
  return {
    id: "d",
    date: "2026-11-03",
    reportTime: "01:00",
    debriefTime: "09:00",
    dutyMinutes: 480,
    flightMinutes: 300,
    sectorCount: 2,
    maxFdpMinutes: 780,
    fdpExtensionUsed: false,
    source: "logbook",
    isFuture: false,
    scheduleEntryIds: [],
    flightIds: [],
    ...over,
  } as DutyPeriod
}

/** Deterministic pseudo-random roster over ~60 days. */
function roster(): DutyPeriod[] {
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const out: DutyPeriod[] = []
  for (let d = 0; d < 60; d++) {
    if (rnd() < 0.35) continue
    const date = new Date(Date.UTC(2026, 8, 1 + d)).toISOString().slice(0, 10)
    const rep = Math.floor(rnd() * 14)
    const dutyMinutes = 300 + Math.floor(rnd() * 400)
    out.push(duty({ id: `d${d}`, date, reportTime: `${String(rep).padStart(2, "0")}:00`, dutyMinutes, flightMinutes: Math.floor(dutyMinutes * 0.6) }))
  }
  return out
}

describe("rollingAt", () => {
  it("equals the pipeline's figure at the end of every day", () => {
    const dps = roster()
    const index = createRollingIndex(buildDutyTimeline(dps, new Map()))
    let compared = 0
    for (let d = 20; d < 64; d++) {
      // 23:59:59 on a day, by which every duty keyed earlier has ended.
      const t = Date.UTC(2026, 8, 1 + d) + 24 * H - 1000
      const ended = dps.filter((dp) => Date.parse(`${dp.date}T${dp.reportTime}:00Z`) + dp.dutyMinutes * MIN <= t)
      if (ended.length !== dps.filter((dp) => dp.date <= new Date(t).toISOString().slice(0, 10)).length) continue
      compared++
      expect(rollingAt(index, "duty14", t)).toBeCloseTo(calculateRollingStats(dps, new Date(t), 14, DEFAULT_FTL_LIMITS).dutyHours * 60, 6)
      expect(rollingAt(index, "duty28", t)).toBeCloseTo(calculateRollingStats(dps, new Date(t), 28, DEFAULT_FTL_LIMITS).dutyHours * 60, 6)
      expect(rollingAt(index, "flight28", t)).toBeCloseTo(calculateRollingStats(dps, new Date(t), 28, DEFAULT_FTL_LIMITS).flightHours * 60, 6)
    }
    expect(compared).toBeGreaterThan(20)
  })

  it("counts a duty in progress as far as it has gone, and standby at its counted share", () => {
    const index = createRollingIndex(
      buildDutyTimeline([duty({ id: "a" }), duty({ id: "s", date: "2026-11-04", reportTime: "00:00", dutyMinutes: 600, countedDutyMinutes: 120, dutyKind: "standby", maxFdpMinutes: 0 })], new Map()),
    )
    expect(rollingAt(index, "duty14", at("2026-11-03T01:00:00Z"))).toBe(0)
    expect(rollingAt(index, "duty14", at("2026-11-03T05:00:00Z"))).toBe(240)
    expect(rollingAt(index, "duty14", at("2026-11-03T10:00:00Z"))).toBe(480)
    // Half the standby gone: half of its 20%.
    expect(rollingAt(index, "duty14", at("2026-11-04T05:00:00Z"))).toBe(480 + 60)
  })

  it("counts flight as the sectors' block time, not pro rata over the duty", () => {
    const f = (id: string, out: string, inn: string) =>
      ({ id, date: "2026-11-03", outTime: out, inTime: inn, departureIcao: "WSSS", arrivalIcao: "VTBS", entryType: "flight" }) as FlightLog
    const flights = new Map([f("x", "02:00", "04:30"), f("y", "05:30", "08:00")].map((x) => [x.id, x]))
    const index = createRollingIndex(buildDutyTimeline([duty({ id: "a", flightIds: ["x", "y"] })], flights))
    expect(rollingAt(index, "flight28", at("2026-11-03T02:00:00Z"))).toBe(0)
    expect(rollingAt(index, "flight28", at("2026-11-03T05:00:00Z"))).toBe(150) // first sector in, on the ground
    expect(rollingAt(index, "flight28", at("2026-11-03T05:30:00Z"))).toBe(150)
    expect(rollingAt(index, "flight28", at("2026-11-03T09:00:00Z"))).toBe(300)
  })

  it("drops a date at the midnight it leaves the window", () => {
    const index = createRollingIndex(buildDutyTimeline([duty({ id: "a" })], new Map()))
    // Keyed 3 Nov: in the 14-day window through 16 Nov, out from 17 Nov 00:00Z.
    expect(rollingAt(index, "duty14", at("2026-11-16T23:59:59Z"))).toBe(480)
    expect(rollingAt(index, "duty14", at("2026-11-17T00:00:00Z"))).toBe(0)
    const series = rollingSeries(index, "duty14", at("2026-11-16T12:00:00Z"), at("2026-11-17T12:00:00Z"))
    expect(series.map((p) => p.v)).toEqual([480, 480, 0, 0])
  })
})

describe("pointerState", () => {
  const blocks = buildDutyTimeline(
    [
      duty({ id: "a", fdpEndTime: "08:30" }),
      duty({ id: "b", date: "2026-11-04", restBefore: { restMinutes: 900, requiredRestMinutes: 600, compliant: true } as DutyPeriod["restBefore"] }),
    ],
    new Map(),
  )

  it("reads duty and FDP so far inside a duty, to the minute", () => {
    const s = pointerState(blocks, at("2026-11-03T04:17:30Z"))
    expect(s.kind).toBe("duty")
    if (s.kind !== "duty") return
    expect(s.dutyMinutes).toBe(197)
    expect(s.fdpMinutes).toBe(197)
    // Past the last on-blocks the FDP holds while the duty runs on.
    const late = pointerState(blocks, at("2026-11-03T08:50:00Z"))
    expect(late.kind === "duty" && late.fdpMinutes).toBe(450)
  })

  it("reads the rest so far between duties, before it commences too", () => {
    const early = pointerState(blocks, at("2026-11-03T09:30:00Z"))
    expect(early.kind === "rest" && early.minutes).toBe(-30)
    const s = pointerState(blocks, at("2026-11-03T20:00:00Z"))
    expect(s.kind === "rest" && s.minutes).toBe(600)
  })
})
