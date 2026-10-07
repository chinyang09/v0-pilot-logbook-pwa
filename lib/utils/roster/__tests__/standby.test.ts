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
  calculateRestUntilLegal,
  calculateRollingStats,
  getDutyPeriodsFromSchedule,
  isDutyExceedingLimits,
  isRestingStandby,
  mergeAdjacentDutyPeriods,
  mergeDutyPeriods,
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

/* ── An un-activated standby is REST ─────────────────────────────────────── */

describe("a standby nobody called is rest, not a duty to rest from", () => {
  const flightDuty = (over: Partial<DutyPeriod> = {}): DutyPeriod =>
    ({
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
      ...over,
    }) as DutyPeriod

  const standbyOn = (date: string, from = "06:00", to = "18:00") =>
    getDutyPeriodsFromSchedule([
      entry({ id: `sb-${date}`, date, reportTime: from, debriefTime: to }),
    ])[0]

  it("takes no rest requirement of its own", () => {
    // Read literally, para 3(1)(c) would demand 12 hours of rest before this
    // 12-hour standby. The crew member spent it at home; that IS rest.
    const [, sb] = calculateAllRestPeriods([
      flightDuty(),
      standbyOn("2026-08-15", "00:00", "12:00"),
    ])
    expect(sb.restBefore).toBeUndefined()
  })

  it("lets the rest period run straight THROUGH it", () => {
    // Duty debriefs 18:00 on the 14th. A standby fills the 15th. The duty on
    // the 16th is measured against the FLIGHT duty, not against the standby —
    // so its rest is the whole two days, not the few hours since the standby
    // ended.
    const timeline = [
      flightDuty(),
      standbyOn("2026-08-15"),
      flightDuty({ id: "f2", date: "2026-08-16", reportTime: "02:00" }),
    ]
    const [, , next] = calculateAllRestPeriods(timeline)
    expect(next.restBefore).toBeDefined()
    expect(next.restBefore!.compliant).toBe(true)
    // 18:00 on the 14th → 02:00 on the 16th is 32 hours, less the hour before
    // a rest period commences. Measured from the standby's 18:00 debrief on
    // the 15th it would have been 8 hours, and non-compliant.
    expect(next.restBefore!.restMinutes).toBe(32 * 60 - 60)
  })

  it("does not restart the rest countdown", () => {
    const r = calculateRestUntilLegal(
      [flightDuty(), standbyOn("2026-08-15")],
      new Date("2026-08-15T20:00:00Z"),
    )
    // The countdown belongs to the flight duty that debriefed on the 14th, not
    // to the standby that had just ended two hours earlier.
    expect(r?.lastDutyDate).toBe("2026-08-14")
    expect(r?.isLegalNow).toBe(true)
  })

  it("still contributes its 20% to the cumulative limits", () => {
    // Being rest for para 3 does not make it invisible to para 12 — 6(7)
    // counts a fifth of it either way.
    const stats = calculateRollingStats(
      [standbyOn("2026-08-15")],
      new Date("2026-08-15T23:59:59Z"),
      14,
      DEFAULT_FTL_LIMITS,
    )
    expect(stats.dutyHours).toBeCloseTo(12 * 0.2, 5)
  })

  it("but an ACTIVATED one is a duty the next flight rests from", () => {
    const called = flightDuty({ id: "called", date: "2026-08-15", reportTime: "10:00" })
    const timeline = truncateActivatedStandby([standbyOn("2026-08-15"), called])
    const sb = timeline.find((dp) => dp.dutyKind === "standby")!
    expect(sb.activatedAt).toBe("10:00")
    expect(isRestingStandby(sb)).toBe(false)
  })
})

/* ── The merge must not swallow it ───────────────────────────────────────── */

describe("a standby survives the merge with the logbook", () => {
  // `mergeDutyPeriods` prefers the logbook for a date and marks that date
  // CONSUMED, which is right for a schedule FLIGHT — an alternative record of
  // the same duty — and wrong for a standby, which is a different duty that
  // happens to share the day. And the day it shares with a flight is exactly
  // the day it was ACTIVATED on, so the one standby whose hours needed
  // accounting for was the one being dropped.
  const standby = getDutyPeriodsFromSchedule([
    entry({ reportTime: "06:00", debriefTime: "18:00" }),
  ])[0]

  const flownThatDay: DutyPeriod = {
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

  it("keeps both duties on a day that was activated", () => {
    const merged = mergeDutyPeriods([flownThatDay], [standby])
    expect(merged).toHaveLength(2)
    expect(merged.some((dp) => dp.dutyKind === "standby")).toBe(true)
  })

  it("and the pair is then truncated rather than double-counted", () => {
    const merged = truncateActivatedStandby(
      mergeDutyPeriods([flownThatDay], [standby]),
    )
    const stats = calculateRollingStats(
      merged,
      new Date("2026-08-14T23:59:59Z"),
      14,
      DEFAULT_FTL_LIMITS,
    )
    // Standby 06:00 → 10:00 at 20% = 0.8h, plus the 10h flight duty. Dropped
    // by the merge this was 10h flat; counted whole it would be 12.4h.
    expect(stats.dutyHours).toBeCloseTo(10.8, 5)
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
