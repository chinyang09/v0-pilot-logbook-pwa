import { describe, expect, it, vi } from "vitest"

// `classifyGroundDuty` lives in the schedule parser, which pulls real
// IndexedDB helpers in at module-eval time. Only the module graph matters
// here — nothing in this file calls the parser itself.
vi.mock("@/lib/db", () => ({
  userDb: { flights: { toArray: vi.fn(async () => []) } },
  isLiveFlight: () => true,
  getAirportByIata: vi.fn(async () => null),
  getAirportTimeInfo: vi.fn(() => ({ offset: 8 })),
  getAllPersonnel: vi.fn(async () => []),
  getCurrentUserPersonnel: vi.fn(async () => null),
  getUserPreferences: vi.fn(async () => ({})),
  DEFAULT_IMPORT_DEFAULTS: {},
}))
vi.mock("@/lib/utils/parsers/shared/airport-enricher", () => ({
  enrichAirportBatch: vi.fn(async () => new Map()),
}))

import {
  applyAcclimatisation,
  calculateAllRestPeriods,
  calculateRollingStats,
  getDutyPeriodsFromSchedule,
  isDutyExceedingLimits,
  mergeAdjacentDutyPeriods,
  truncateActivatedStandby,
  HOME_STANDBY_DUTY_FRACTION,
  MAX_STANDBY_HOURS_FLIGHT_CREW,
} from "../fdp-calculator"
import { classifyGroundDuty } from "@/lib/utils/parsers/schedule-parser"
import {
  DEFAULT_FTL_LIMITS,
  type DutyPeriod,
  type ScheduleEntry,
} from "@/types/entities/roster.types"

/**
 * FIFTH SCHEDULE paragraph 6 — Standby duty.
 *
 *   (2) The length of any standby duty must not exceed —
 *       (a) 18 hours for a flight crew member; …
 *   (6) When an AOC holder activates a person who is on standby as a crew
 *       member — (a) the standby duty ceases from the moment the crew member
 *       is activated for duty; and (b) the duty period commences from the
 *       moment that crew member reports for duty at the designated reporting
 *       point.
 *   (7) Only 20% of the total time spent on standby at home or in local
 *       accommodation will be counted in the total period of standby for the
 *       purpose of determining cumulative duty limits under paragraph 12.
 *
 * Standby is a DUTY period but not a FLIGHT duty period, so paragraph 14's
 * tables never apply to it — it carries no FDP maximum. What it does do is
 * occupy the timeline, which is what makes the rest before it checkable.
 */

const entry = (over: Partial<ScheduleEntry>): ScheduleEntry =>
  ({
    id: over.id ?? "sb",
    date: "2026-08-14",
    timeReference: "UTC",
    dutyType: "standby",
    dutyCode: "BKUP",
    sectors: [],
    crew: [],
    importedAt: 0,
    createdAt: 0,
    syncStatus: "synced",
    ...over,
  }) as ScheduleEntry

/* ── Which rows are standby ──────────────────────────────────────────────── */

describe("classifyGroundDuty", () => {
  it("recognises the company's standby codes", () => {
    for (const code of ["SBYG", "SBYA", "SBY", "BKUP", "STBY"]) {
      expect(classifyGroundDuty(code, ""), code).toBe("standby")
    }
  })

  it("recognises days off and leave", () => {
    expect(classifyGroundDuty("LOFF", "Local Day Off for Tech Crew")).toBe("off")
    expect(classifyGroundDuty("OOFF", "")).toBe("off")
    expect(classifyGroundDuty("ALL", "Annual Leave")).toBe("leave")
    expect(classifyGroundDuty("CCL", "")).toBe("leave")
  })

  it("falls back to a ground duty rather than guessing", () => {
    expect(classifyGroundDuty("MEET", "Office meeting")).toBe("ground")
  })

  it("reads the description when the code says nothing", () => {
    expect(classifyGroundDuty("XX1", "Airport Standby")).toBe("standby")
  })

  it("declines a row with no duty code at all", () => {
    expect(classifyGroundDuty("", "")).toBeNull()
  })
})

/* ── The duty period a standby produces ──────────────────────────────────── */

describe("a standby as a duty period", () => {
  const [dp] = getDutyPeriodsFromSchedule([
    entry({ reportTime: "06:00", debriefTime: "18:00" }),
  ])

  it("carries its real length", () => {
    expect(dp.dutyMinutes).toBe(12 * 60)
  })

  it("counts 20% of it toward the cumulative limits — para 6(7)", () => {
    expect(HOME_STANDBY_DUTY_FRACTION).toBe(0.2)
    expect(dp.countedDutyMinutes).toBe(12 * 60 * 0.2)
  })

  it("carries NO FDP maximum — it is not a flight duty period", () => {
    expect(dp.maxFdpMinutes).toBe(0)
    expect(dp.dutyKind).toBe("standby")
    expect(dp.sectorCount).toBe(0)
  })

  it("is never reported as exceeding an FDP it does not have", () => {
    // Read against a maximum of 0, a 12-hour standby is an exceedance of 12
    // hours — an alarm on the one duty paragraph 14 says nothing about.
    const r = isDutyExceedingLimits(dp, DEFAULT_FTL_LIMITS)
    expect(r.exceedsFDP).toBe(false)
    expect(r.exceeds).toBe(false)
  })

  it("handles a window that crosses midnight", () => {
    const [overnight] = getDutyPeriodsFromSchedule([
      entry({ id: "n", reportTime: "22:00", debriefTime: "06:00" }),
    ])
    expect(overnight.dutyMinutes).toBe(8 * 60)
  })
})

describe("para 6(2)(a) — 18 hours for a flight crew member", () => {
  it("is the cap", () => {
    expect(MAX_STANDBY_HOURS_FLIGHT_CREW).toBe(18)
  })

  it("passes a standby at exactly 18 hours", () => {
    const [dp] = getDutyPeriodsFromSchedule([
      entry({ reportTime: "00:00", debriefTime: "18:00" }),
    ])
    expect(isDutyExceedingLimits(dp, DEFAULT_FTL_LIMITS).exceeds).toBe(false)
  })

  it("flags one beyond it", () => {
    const [dp] = getDutyPeriodsFromSchedule([
      entry({ reportTime: "00:00", debriefTime: "18:30" }),
    ])
    expect(isDutyExceedingLimits(dp, DEFAULT_FTL_LIMITS).exceeds).toBe(true)
  })
})

/* ── Cumulative limits ───────────────────────────────────────────────────── */

describe("what reaches the 90h / 180h limits", () => {
  const flightDuty = (over: Partial<DutyPeriod>): DutyPeriod =>
    ({
      id: "f",
      date: "2026-08-14",
      reportTime: "06:00",
      debriefTime: "16:00",
      dutyMinutes: 10 * 60,
      flightMinutes: 8 * 60,
      sectorCount: 2,
      maxFdpMinutes: 780,
      fdpExtensionUsed: false,
      source: "logbook",
      isFuture: false,
      scheduleEntryIds: [],
      flightIds: [],
      ...over,
    }) as DutyPeriod

  it("counts an ordinary duty in full", () => {
    const stats = calculateRollingStats(
      [flightDuty({})],
      new Date("2026-08-14T23:59:59Z"),
      14,
      DEFAULT_FTL_LIMITS,
    )
    expect(stats.dutyHours).toBe(10)
  })

  it("counts a home standby at a fifth", () => {
    const [sb] = getDutyPeriodsFromSchedule([
      entry({ date: "2026-08-13", reportTime: "06:00", debriefTime: "16:00" }),
    ])
    const stats = calculateRollingStats(
      [sb],
      new Date("2026-08-14T23:59:59Z"),
      14,
      DEFAULT_FTL_LIMITS,
    )
    // Ten hours of standby is two hours of counted duty. Counted in full it
    // would be ten, which over-states the limit; counted at nothing — which is
    // what happened before standby was tracked at all — it under-states it.
    expect(stats.dutyHours).toBe(2)
  })
})

/* ── Para 6(6) — activation ──────────────────────────────────────────────── */

describe("a standby that gets called out", () => {
  const standby = getDutyPeriodsFromSchedule([
    entry({ reportTime: "06:00", debriefTime: "18:00" }),
  ])[0]

  const calledOut: DutyPeriod = {
    id: "flight",
    date: "2026-08-14",
    reportTime: "10:00",
    debriefTime: "20:00",
    dutyMinutes: 10 * 60,
    flightMinutes: 8 * 60,
    sectorCount: 2,
    maxFdpMinutes: 780,
    fdpExtensionUsed: false,
    source: "logbook",
    isFuture: false,
    scheduleEntryIds: [],
    flightIds: [],
  }

  it("ends at the moment of activation", () => {
    const [sb] = truncateActivatedStandby([standby, calledOut]).filter(
      (dp) => dp.dutyKind === "standby",
    )
    // Reported for the flight at 10:00, so the standby ran 06:00 → 10:00.
    expect(sb.dutyMinutes).toBe(4 * 60)
    expect(sb.activatedAt).toBe("10:00")
  })

  it("does not count the called-out hours twice", () => {
    const truncated = truncateActivatedStandby([standby, calledOut])
    const stats = calculateRollingStats(
      truncated,
      new Date("2026-08-14T23:59:59Z"),
      14,
      DEFAULT_FTL_LIMITS,
    )
    // 4h standby at 20% = 0.8, plus the 10h flight duty in full.
    expect(stats.dutyHours).toBeCloseTo(10.8, 5)
  })

  it("leaves a standby that was never called out alone", () => {
    const [sb] = truncateActivatedStandby([standby])
    expect(sb.dutyMinutes).toBe(12 * 60)
    expect(sb.activatedAt).toBeUndefined()
  })

  it("ignores a duty that reports after the standby ended", () => {
    const later = { ...calledOut, reportTime: "19:00", id: "later" }
    const [sb] = truncateActivatedStandby([standby, later])
    expect(sb.dutyMinutes).toBe(12 * 60)
  })
})

/* ── Rest before a standby ───────────────────────────────────────────────── */

describe("rest before a standby is checked", () => {
  const flightDuty: DutyPeriod = {
    id: "f",
    date: "2026-08-14",
    reportTime: "06:00",
    debriefTime: "18:00",
    dutyMinutes: 12 * 60,
    flightMinutes: 9 * 60,
    sectorCount: 2,
    maxFdpMinutes: 735,
    fdpExtensionUsed: false,
    source: "logbook",
    isFuture: false,
    scheduleEntryIds: [],
    flightIds: [],
  }

  it("flags a standby that starts before the rest requirement is met", () => {
    // The preceding duty ran 12 hours, so para 3(1)(c) asks for 12 hours of
    // rest. This standby reports 6 hours later. Without standby in the
    // timeline there was nothing here to check at all.
    const [sbDp] = getDutyPeriodsFromSchedule([
      entry({ date: "2026-08-15", reportTime: "00:00", debriefTime: "12:00" }),
    ])
    const [, standby] = calculateAllRestPeriods([flightDuty, sbDp])
    expect(standby.restBefore).toBeDefined()
    expect(standby.restBefore!.compliant).toBe(false)
  })

  it("accepts one that starts after it", () => {
    const [sbDp] = getDutyPeriodsFromSchedule([
      entry({ date: "2026-08-15", reportTime: "08:00", debriefTime: "20:00" }),
    ])
    const [, standby] = calculateAllRestPeriods([flightDuty, sbDp])
    expect(standby.restBefore!.compliant).toBe(true)
  })
})

/* ── Standby must not contaminate the flight-duty machinery ──────────────── */

describe("a standby stays out of the flight duty pipeline", () => {
  it("is not merged into an adjacent flight duty", () => {
    // The gap between them is under the 10 hours that triggers a merge, but
    // they are different kinds of duty period: one carries a paragraph 14
    // maximum and the other cannot.
    const [sb] = getDutyPeriodsFromSchedule([
      entry({ reportTime: "06:00", debriefTime: "10:00" }),
    ])
    const flight: DutyPeriod = {
      ...sb,
      id: "flight",
      dutyKind: undefined,
      standbyKind: undefined,
      countedDutyMinutes: undefined,
      reportTime: "12:00",
      debriefTime: "20:00",
      dutyMinutes: 8 * 60,
      sectorCount: 2,
      maxFdpMinutes: 735,
      source: "logbook",
    }
    const merged = mergeAdjacentDutyPeriods([sb, flight])
    expect(merged).toHaveLength(2)
  })

  it("is not given an FDP maximum by the acclimatisation pass", () => {
    // `applyAcclimatisation` re-derives every duty's maximum. A standby has no
    // sectors, so a lookup would hand it the one-sector figure.
    const [sb] = getDutyPeriodsFromSchedule([
      entry({ reportTime: "06:00", debriefTime: "18:00" }),
    ])
    const [out] = applyAcclimatisation([sb])
    expect(out.maxFdpMinutes).toBe(0)
    expect(out.fdpTableUsed).toBeUndefined()
  })
})
