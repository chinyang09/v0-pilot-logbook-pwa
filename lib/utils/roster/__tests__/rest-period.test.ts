import { describe, expect, it } from "vitest"

import { calculateRestPeriod, calculateRestUntilLegal } from "../fdp-calculator"
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
 * "Local night" is defined in the FIRST SCHEDULE as a period of 8 hours falling
 * between 2200 and 0800 LOCAL time — see `regulation-definitions.test.ts`.
 * Duty period times here are UTC, and the fixtures are read in Singapore local
 * time (UTC+8) unless a fixture says otherwise.
 *
 * A rest period commences ONE HOUR after the crew member is free of all duties,
 * so the figures below are the gap between debrief and report less 60 minutes.
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
    // Debrief is 03:00 on the 15th; rest to 18:00 the same day is 15 hours,
    // less the hour before a rest period commences.
    expect(r.restMinutes).toBe(15 * 60 - 60)
    expect(r.precedingDutyMinutes).toBe(6 * 60)
  })
})


describe("the local night is the DEFINED one, not a fixed 2200–0600 band", () => {
  it("counts a night that runs 0000 to 0800 local", () => {
    // Eight full hours between 2200 and 0800, none of it before midnight. The
    // old fixed 2200–0600 band called this no local night and asked for 12
    // hours of rest instead of 10.
    const r = calculateRestPeriod(
      duty({ date: "2026-08-15", reportTime: "01:00" }), // 09:00 SGT
      duty({ date: "2026-08-14", debriefTime: "15:30", dutyMinutes: 8 * 60 }), // 23:30 SGT
    )
    expect(r.includesLocalNight).toBe(true)
    expect(r.requiredRestMinutes).toBe(10 * 60)
  })

  it("rejects a rest that only clips the edge of the window", () => {
    // 21:00 → 23:00 SGT touches the window for an hour. Any-overlap logic
    // called that a local night and granted the 10-hour rule.
    const r = calculateRestPeriod(
      duty({ date: "2026-08-14", reportTime: "15:00" }), // 23:00 SGT
      duty({ date: "2026-08-14", debriefTime: "13:00", dutyMinutes: 8 * 60 }), // 21:00 SGT
    )
    expect(r.includesLocalNight).toBe(false)
    expect(r.requiredRestMinutes).toBe(12 * 60)
  })

  it("measures the night where the crew member actually is", () => {
    // Rest taken at a UTC+0 station: 22:00 → 08:00 THERE is a local night,
    // even though in Singapore it is the middle of the working day.
    const away = calculateRestPeriod(
      duty({ date: "2026-08-15", reportTime: "09:00" }),
      duty({
        date: "2026-08-14",
        debriefTime: "21:00",
        dutyMinutes: 8 * 60,
        arrivalTimezoneOffset: 0,
      }),
    )
    expect(away.includesLocalNight).toBe(true)

    // The same absolute rest, but recorded as ending at home base, is not one.
    const home = calculateRestPeriod(
      duty({ date: "2026-08-15", reportTime: "09:00" }),
      duty({
        date: "2026-08-14",
        debriefTime: "21:00",
        dutyMinutes: 8 * 60,
        arrivalTimezoneOffset: 8,
      }),
    )
    expect(home.includesLocalNight).toBe(false)
  })
})

/**
 * `calculateRestUntilLegal` — the EARLIEST a duty may be planned.
 *
 * Paragraph 3(1)(a) and (b) are conditions on the rest period AS PROVIDED, and
 * whether it includes a local night grows as the crew member waits. So the
 * answer is a search for the earliest end, not a single lookup:
 *
 *   • wait for a local night → 10 hours suffices, but not before the night
 *     itself completes;
 *   • do not → 12 hours.
 *
 * Whichever comes first. Testing once over a hypothetical 10-hour rest and
 * falling to 12 hours when that failed missed everything in between.
 */
describe("the earliest a duty may be planned", () => {
  const flown = (over: Partial<DutyPeriod>) =>
    duty({ arrivalTimezoneOffset: 8, ...over })

  /** Local clock at UTC+8, for readable expectations. */
  const sgt = (iso: string) =>
    new Date(Date.parse(iso) + 8 * 3_600_000).toISOString().slice(11, 16)

  it("waits for the local night rather than jumping to 12 hours", () => {
    // The reported case. Debrief 09:26Z = 17:26 SGT, so rest commences 18:26
    // SGT. Ten hours of rest ends 04:26, which has only 6h26m inside the
    // 2200–0800 window — no local night, and the old code therefore reported
    // 12 hours and 06:26.
    //
    // But by 06:00 the rest contains a full 22:00–06:00 night, and 11h34m is
    // comfortably more than the 10 hours para 3(1)(a) then asks for. 06:00 is
    // the honest answer and it is 26 minutes earlier.
    const r = calculateRestUntilLegal(
      [flown({ date: "2026-08-15", reportTime: "03:10", debriefTime: "09:26", dutyMinutes: 6 * 60 + 16 })],
      new Date("2026-08-15T10:14:00Z"),
    )
    expect(r).not.toBeNull()
    expect(r!.rule).toBe("3a")
    expect(sgt(r!.legalAtUtc)).toBe("06:00")
    expect(r!.requiredRestMinutes).toBe(11 * 60 + 34)
  })

  it("gives the plain 10 hours when the night is already covered by them", () => {
    // Debrief 13:00Z = 21:00 SGT, rest from 22:00 SGT. Ten hours ends 08:00 —
    // exactly the full window, so there is nothing to wait for.
    const r = calculateRestUntilLegal(
      [flown({ date: "2026-08-15", reportTime: "05:00", debriefTime: "13:00", dutyMinutes: 8 * 60 })],
      new Date("2026-08-15T14:00:00Z"),
    )
    expect(r!.rule).toBe("3a")
    expect(r!.requiredRestMinutes).toBe(10 * 60)
    expect(sgt(r!.legalAtUtc)).toBe("08:00")
  })

  it("falls to 12 hours when waiting for a night would take longer", () => {
    // Debrief 22:30Z = 06:30 SGT: rest commences 07:30, and the next window
    // does not open until 22:00. Waiting for the night would mean resting
    // until 06:00 the following morning — 22h30m — where 3(1)(b)'s 12 hours
    // ends at 19:30 the same day. The shorter of the two governs.
    const r = calculateRestUntilLegal(
      [flown({ date: "2026-08-15", reportTime: "14:30", debriefTime: "22:30", dutyMinutes: 8 * 60 })],
      new Date("2026-08-15T23:00:00Z"),
    )
    expect(r!.rule).toBe("3b")
    expect(r!.requiredRestMinutes).toBe(12 * 60)
    expect(sgt(r!.legalAtUtc)).toBe("19:30")
  })

  it("still honours a longer floor from 3(1)(c)", () => {
    // A 13-hour duty asks for 13 hours under 3(1)(c) whichever way the night
    // falls, so the night branch cannot undercut it.
    const r = calculateRestUntilLegal(
      // Reports 20:26 on the 14th and debriefs 09:26 on the 15th.
      [flown({ date: "2026-08-14", reportTime: "20:26", debriefTime: "09:26", dutyMinutes: 13 * 60 })],
      new Date("2026-08-15T10:14:00Z"),
    )
    expect(r!.requiredRestMinutes).toBeGreaterThanOrEqual(13 * 60)
    expect(r!.rule).toBe("3c")
  })

  it("measures the night where the crew member actually is", () => {
    // The same absolute rest, taken at a UTC+0 station. 18:26 SGT is 10:26
    // there — the middle of the morning — so the night is a long way off and
    // the 12-hour rule governs instead.
    const r = calculateRestUntilLegal(
      [flown({ date: "2026-08-15", reportTime: "03:10", debriefTime: "09:26", dutyMinutes: 6 * 60 + 16, arrivalTimezoneOffset: 0 })],
      new Date("2026-08-15T10:14:00Z"),
    )
    expect(r!.rule).toBe("3b")
    expect(r!.requiredRestMinutes).toBe(12 * 60)
  })
})
