/**
 * The FDP Quick Check (`simulateScenario`) — what it reports as a violation.
 *
 * It carried its own copy of the FDP check, `dutyMinutes > maxFdpMinutes`,
 * beside the one `isDutyExceedingLimits` already had right:
 *   - a STANDBY carries `maxFdpMinutes: 0`, so read as a limit every standby
 *     after the hypothetical duty was "FDP exceeded";
 *   - the duty runs on past the FDP by para 7(2)'s post-flight checks, so a
 *     duty ending inside its last half hour read as an exceedance;
 *   - the "affected" set grew as it was walked, so every duty after the first
 *     change was checked and an existing problem was reported as the
 *     scenario's.
 */

import { describe, it, expect } from "vitest"
import { fdpMinutesOf, getDutyPeriodsFromSchedule, isDutyExceedingLimits, simulateScenario } from "../fdp-calculator"
import { DEFAULT_FTL_LIMITS, type DutyPeriod, type ScheduleEntry } from "@/types/entities/roster.types"

const standby = (date: string, report: string, debrief: string): DutyPeriod =>
  getDutyPeriodsFromSchedule([
    {
      id: `sb-${date}`,
      date,
      timeReference: "UTC",
      dutyType: "standby",
      dutyCode: "SBY",
      reportTime: report,
      debriefTime: debrief,
      sectors: [],
      crew: [],
      importedAt: 0,
      createdAt: 0,
      syncStatus: "synced",
    } as unknown as ScheduleEntry,
  ])[0]

const add = (id: string, date: string, reportTime: string, debriefTime: string) => ({
  id,
  type: "add" as const,
  date,
  reportTime,
  debriefTime,
  flightMinutes: 120,
  sectorCount: 2,
})

/** The maximum the scenario gives a 2-sector duty reporting at `report`. */
function maxFor(report: string): number {
  const r = simulateScenario([], [add("probe", "2026-09-01", report, report === "00:00" ? "01:00" : "23:59")], DEFAULT_FTL_LIMITS)
  return Math.round((r.timelineData.find((p) => p.date === "2026-09-01")?.maxFdpHours ?? 0) * 60)
}

const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`

describe("simulateScenario — FDP violations", () => {
  it("never reports a standby as exceeding an FDP it does not have", () => {
    const sb = standby("2026-09-03", "00:00", "12:00")
    expect(sb.maxFdpMinutes).toBe(0)
    const r = simulateScenario([sb], [add("a", "2026-09-02", "00:00", "08:00")], DEFAULT_FTL_LIMITS)
    expect(r.violations.filter((v) => v.type === "fdp")).toEqual([])
  })

  it("measures the FDP to the last on-blocks, not the debrief", () => {
    const max = maxFor("00:00")
    expect(max).toBeGreaterThan(0)
    // Debrief 20 minutes past the maximum: the FDP ended 10 minutes inside it.
    const inside = simulateScenario([], [add("a", "2026-09-02", "00:00", hhmm(max + 20))], DEFAULT_FTL_LIMITS)
    expect(inside.violations.filter((v) => v.type === "fdp")).toEqual([])
    // 40 minutes past: the FDP is 10 minutes over.
    const over = simulateScenario([], [add("a", "2026-09-02", "00:00", hhmm(max + 40))], DEFAULT_FTL_LIMITS)
    const fdp = over.violations.filter((v) => v.type === "fdp")
    expect(fdp).toHaveLength(1)
    expect(Math.round(fdp[0].projected * 60)).toBe(max + 10)
  })

  it("checks the duty after a change, and not every duty after that", () => {
    // An existing over-long duty a week later is not the scenario's doing.
    const later: DutyPeriod = {
      ...standby("2026-09-10", "00:00", "16:00"),
      id: "later",
      dutyKind: undefined,
      sectorCount: 2,
      maxFdpMinutes: 600,
      fdpEndTime: "15:30",
    }
    const next = standby("2026-09-03", "00:00", "06:00")
    expect(isDutyExceedingLimits(later, DEFAULT_FTL_LIMITS).exceedsFDP).toBe(true)
    const r = simulateScenario([next, later], [add("a", "2026-09-02", "00:00", "08:00")], DEFAULT_FTL_LIMITS)
    expect(r.violations.map((v) => v.date)).not.toContain("2026-09-10")
  })
})

describe("fdpMinutesOf", () => {
  const dp = (over: Partial<DutyPeriod>) =>
    ({ reportTime: "22:00", debriefTime: "08:30", dutyMinutes: 630, ...over }) as DutyPeriod

  it("runs from report to the last on-blocks, across midnight", () => {
    expect(fdpMinutesOf(dp({ fdpEndTime: "08:00" }))).toBe(600)
  })

  it("adds what para 10(b) spent before the report", () => {
    expect(fdpMinutesOf(dp({ fdpEndTime: "08:00", fdpElapsedAtReport: 45 }))).toBe(645)
  })

  it("falls back to the duty when no last on-blocks is recorded", () => {
    expect(fdpMinutesOf(dp({}))).toBe(630)
  })

  it("never exceeds the duty it sits inside", () => {
    expect(fdpMinutesOf(dp({ fdpEndTime: "21:59" }))).toBe(630)
  })
})
