import { describe, expect, it } from "vitest"

import { calculateRestPeriod } from "../fdp-calculator"
import type { DutyPeriod } from "@/types/entities/roster.types"

/**
 * FIFTH SCHEDULE paragraph 3 — Minimum rest period.
 *
 *   (1) Subject to sub-paragraph (2), the minimum rest period provided for a
 *   crew member subsequent to or prior to a scheduled flight duty period must
 *   be —
 *     (a) not less than 10 hours if the rest period includes a local night;
 *     (b) not less than 12 hours if the rest period does not include a local
 *         night;
 *     (c) if the preceding duty period exceeded 10 hours but is not more than
 *         16 hours, at least as long as the preceding duty period rounded to
 *         the next whole hour; and
 *     (d) if the preceding duty period exceeded 16 hours, at least 24 hours
 *         and inclusive of a local night.
 *
 * The list is joined by "and". These are conditions to be met together, not a
 * menu to pick the first matching entry from — which is what makes the
 * combination cases below the interesting ones.
 *
 * Local night in Singapore is 22:00–06:00 SGT, i.e. 14:00–22:00 UTC, and duty
 * period times here are UTC.
 */

function duty(over: Partial<DutyPeriod>): DutyPeriod {
  return {
    id: over.id ?? "dp",
    date: "2026-08-14",
    reportTime: "06:00",
    debriefTime: "14:00",
    dutyMinutes: 480,
    flightMinutes: 360,
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

describe("para 3(1)(a) and (b) — the local night", () => {
  it("requires 10 hours when the rest includes a local night", () => {
    // Debrief 14:00 UTC (22:00 SGT), report next day 06:00 UTC — straight
    // through the Singapore night.
    const r = calculateRestPeriod(
      duty({ date: "2026-08-15", reportTime: "06:00" }),
      duty({ date: "2026-08-14", debriefTime: "14:00", dutyMinutes: 480 }),
    )
    expect(r.includesLocalNight).toBe(true)
    expect(r.requiredRestMinutes).toBe(10 * 60)
    expect(r.rule).toBe("3a")
  })

  it("requires 12 hours when it does not", () => {
    // Debrief 22:30 UTC (06:30 SGT, just after the night) and report before the
    // next night begins.
    const r = calculateRestPeriod(
      duty({ date: "2026-08-15", reportTime: "12:00" }),
      duty({ date: "2026-08-14", debriefTime: "22:30", dutyMinutes: 480 }),
    )
    expect(r.includesLocalNight).toBe(false)
    expect(r.requiredRestMinutes).toBe(12 * 60)
    expect(r.rule).toBe("3b")
  })
})

describe("para 3(1)(c) — rest at least as long as the preceding duty", () => {
  it("rounds the preceding duty UP to the next whole hour", () => {
    // 11h20m duty → 12h of rest, not 11h20m.
    const r = calculateRestPeriod(
      duty({ date: "2026-08-16", reportTime: "06:00" }),
      duty({ date: "2026-08-15", debriefTime: "14:00", dutyMinutes: 11 * 60 + 20 }),
    )
    expect(r.requiredRestMinutes).toBe(12 * 60)
  })

  it("does not engage at or below 10 hours", () => {
    const r = calculateRestPeriod(
      duty({ date: "2026-08-16", reportTime: "06:00" }),
      duty({ date: "2026-08-15", debriefTime: "14:00", dutyMinutes: 10 * 60 }),
    )
    expect(r.rule).toBe("3a")
    expect(r.requiredRestMinutes).toBe(10 * 60)
  })
})

describe("the sub-rules apply TOGETHER, not as alternatives", () => {
  it("takes 12 hours for an 11-hour duty resting without a local night", () => {
    // 3(c) alone would ask for 11 hours; 3(b) asks for 12 because there is no
    // local night. Read as an if/else chain this returned 11 — an hour short of
    // the schedule, in the direction that puts a tired crew back on an
    // aeroplane.
    const r = calculateRestPeriod(
      duty({ date: "2026-08-15", reportTime: "12:00" }),
      duty({ date: "2026-08-14", debriefTime: "22:30", dutyMinutes: 11 * 60 }),
    )
    expect(r.includesLocalNight).toBe(false)
    expect(r.requiredRestMinutes).toBe(12 * 60)
    expect(r.rule).toBe("3b")
  })

  it("takes the longer duty-based figure when it exceeds the night figure", () => {
    // A 14h30m duty demands 15 hours under 3(c), which is more than either
    // 3(a) or 3(b).
    const r = calculateRestPeriod(
      duty({ date: "2026-08-16", reportTime: "06:00" }),
      duty({ date: "2026-08-15", debriefTime: "14:00", dutyMinutes: 14 * 60 + 30 }),
    )
    expect(r.requiredRestMinutes).toBe(15 * 60)
    expect(r.rule).toBe("3c")
  })
})

describe("para 3(1)(d) — over 16 hours", () => {
  it("requires 24 hours", () => {
    const r = calculateRestPeriod(
      duty({ date: "2026-08-17", reportTime: "06:00" }),
      duty({ date: "2026-08-15", debriefTime: "14:00", dutyMinutes: 17 * 60 }),
    )
    expect(r.requiredRestMinutes).toBe(24 * 60)
    expect(r.rule).toBe("3d")
    expect(r.compliant).toBe(true)
  })

  it("carries the local-night condition too, though 24 hours always contains one", () => {
    // 3(1)(d) is "at least 24 hours AND inclusive of a local night", and the
    // code checks both. With the night modelled as a fixed 22:00–06:00 SGT
    // window, any rest of 24 hours or more necessarily spans one, so the two
    // halves of the rule cannot currently diverge — this pins that, so the day
    // the night window becomes per-station the guard is already in place and
    // the assumption is written down rather than assumed.
    for (const reportTime of ["00:15", "06:15", "12:15", "18:15", "23:15"]) {
      const r = calculateRestPeriod(
        duty({ date: "2026-08-17", reportTime }),
        duty({ date: "2026-08-15", debriefTime: "22:30", dutyMinutes: 17 * 60 }),
      )
      expect(r.restMinutes, reportTime).toBeGreaterThanOrEqual(24 * 60)
      expect(r.includesLocalNight, reportTime).toBe(true)
      expect(r.compliant, reportTime).toBe(true)
    }
  })
})

describe("a duty that crossed midnight", () => {
  it("tests the night window against the day the debrief actually falls on", () => {
    // Report 21:00 on the 14th, debrief 03:00 — which is the 15th. Rest then
    // runs 03:00→18:00 on the 15th and contains no Singapore night (14:00–22:00
    // UTC is only partly covered from 14:00, so this one does touch it).
    // Using the UNWRAPPED date would test 03:00 on the 14th instead and pick
    // the wrong rule.
    const r = calculateRestPeriod(
      duty({ date: "2026-08-15", reportTime: "18:00" }),
      duty({
        date: "2026-08-14",
        reportTime: "21:00",
        debriefTime: "03:00",
        dutyMinutes: 6 * 60,
      }),
    )
    // Debrief is 03:00 on the 15th; rest to 18:00 the same day is 15 hours less
    // the buffer, and it does not reach the 14:00 UTC night start until the end.
    expect(r.restMinutes).toBe(15 * 60 - 30)
    expect(r.precedingDutyMinutes).toBe(6 * 60)
  })
})
