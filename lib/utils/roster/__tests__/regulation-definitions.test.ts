import { describe, expect, it } from "vitest"

import {
  containsLocalNight,
  countsConsecutiveLocalNights,
  acclimatisedOffsetMinutes,
  isEarlyStart,
  isLateFinish,
  isInWindowOfCircadianLow,
  localMinuteOfDay,
  withinAcclimatisedWindow,
  REST_STARTS_AFTER_DUTY_MIN,
  PRE_FLIGHT_CHECK_MIN,
  POST_FLIGHT_CHECK_MIN,
} from "../regulation-definitions"
import { applyAcclimatisation } from "../fdp-calculator"
import type { DutyPeriod } from "@/types/entities/roster.types"

/**
 * FIRST SCHEDULE (Regulation 2) — DEFINITIONS.
 *
 * Transcribed from the schedule, not from the implementation. Several of these
 * were assumptions in the code before the definitions were to hand, and the
 * assumptions were wrong.
 */

const SGT = 8 * 60
const UTC = 0
/** 2026-08-14T00:00:00Z as a base for readable fixtures. */
const D = (iso: string) => Date.parse(iso)

describe('"Local night" — 8 hours falling between 2200 and 0800 local', () => {
  it("accepts the earliest qualifying period, 2200 to 0600", () => {
    expect(
      containsLocalNight(D("2026-08-14T14:00:00Z"), D("2026-08-14T22:00:00Z"), SGT),
    ).toBe(true) // 22:00 → 06:00 SGT
  })

  it("accepts the latest qualifying period, 0000 to 0800", () => {
    // This is the case a fixed 2200–0600 band gets WRONG: a full eight hours
    // between 2200 and 0800, but none of it before midnight.
    expect(
      containsLocalNight(D("2026-08-14T16:00:00Z"), D("2026-08-15T00:00:00Z"), SGT),
    ).toBe(true) // 00:00 → 08:00 SGT
  })

  it("accepts a period sitting anywhere inside the window", () => {
    expect(
      containsLocalNight(D("2026-08-14T15:00:00Z"), D("2026-08-14T23:00:00Z"), SGT),
    ).toBe(true) // 23:00 → 07:00 SGT
  })

  it("rejects less than 8 hours inside the window", () => {
    // 23:00 → 06:30 SGT is only 7½ hours between 2200 and 0800.
    expect(
      containsLocalNight(D("2026-08-14T15:00:00Z"), D("2026-08-14T22:30:00Z"), SGT),
    ).toBe(false)
  })

  it("rejects a long rest that misses the window", () => {
    // 09:00 → 21:00 SGT: twelve hours, none of it between 2200 and 0800.
    expect(
      containsLocalNight(D("2026-08-14T01:00:00Z"), D("2026-08-14T13:00:00Z"), SGT),
    ).toBe(false)
  })

  it("counts hours inside the window, not hours of rest", () => {
    // 20:00 → 05:00 SGT is nine hours of rest but only seven of them (2200 →
    // 0500) fall in the window.
    expect(
      containsLocalNight(D("2026-08-14T12:00:00Z"), D("2026-08-14T21:00:00Z"), SGT),
    ).toBe(false)
  })

  it("is evaluated in the zone the crew member is actually in", () => {
    // The same absolute interval is a local night in one zone and not in
    // another. 22:00 → 06:00 in UTC is 06:00 → 14:00 in SGT.
    const start = D("2026-08-14T22:00:00Z")
    const end = D("2026-08-15T06:00:00Z")
    expect(containsLocalNight(start, end, UTC)).toBe(true)
    expect(containsLocalNight(start, end, SGT)).toBe(false)
  })

  it("finds a night anywhere inside a multi-day rest", () => {
    expect(
      containsLocalNight(D("2026-08-14T02:00:00Z"), D("2026-08-17T02:00:00Z"), SGT),
    ).toBe(true)
  })
})

describe("consecutive local nights", () => {
  it("counts each night a duty-free interval fully covers", () => {
    // 2026-08-14 09:00 SGT → 2026-08-18 09:00 SGT covers the nights of the
    // 14th, 15th, 16th and 17th.
    const n = countsConsecutiveLocalNights(
      D("2026-08-14T01:00:00Z"),
      D("2026-08-18T01:00:00Z"),
      SGT,
    )
    expect(n).toBe(4)
  })

  it("counts none when the interval never covers a full night", () => {
    expect(
      countsConsecutiveLocalNights(
        D("2026-08-14T01:00:00Z"),
        D("2026-08-14T09:00:00Z"),
        SGT,
      ),
    ).toBe(0)
  })
})

describe('"Acclimated" — 3 consecutive local nights free of duty in a zone', () => {
  const homeDuty = (day: number, zone: number) => ({
    startMs: D(`2026-08-${day}T00:00:00Z`),
    endMs: D(`2026-08-${day}T09:00:00Z`),
    endZoneOffsetMinutes: zone,
  })

  it("stays with home base until three nights have been spent elsewhere", () => {
    // One duty into a UTC+0 station, then back the next day — nowhere near
    // three nights, so the crew member is still acclimated to Singapore.
    const duties = [
      { ...homeDuty(14, UTC) },
      { ...homeDuty(15, SGT) },
    ]
    expect(acclimatisedOffsetMinutes(duties, SGT, D("2026-08-16T00:00:00Z"))).toBe(SGT)
  })

  it("re-acclimatises after three consecutive local nights free of duty", () => {
    // Arrives in UTC+0 on the 14th and does nothing until the 19th — the
    // nights of the 14th, 15th, 16th, 17th and 18th are all free.
    const duties = [
      {
        startMs: D("2026-08-14T00:00:00Z"),
        endMs: D("2026-08-14T09:00:00Z"),
        endZoneOffsetMinutes: UTC,
      },
    ]
    expect(acclimatisedOffsetMinutes(duties, SGT, D("2026-08-19T00:00:00Z"))).toBe(UTC)
  })

  it("does NOT re-acclimatise on two nights", () => {
    const duties = [
      {
        startMs: D("2026-08-14T00:00:00Z"),
        endMs: D("2026-08-14T09:00:00Z"),
        endZoneOffsetMinutes: UTC,
      },
      {
        startMs: D("2026-08-16T20:00:00Z"),
        endMs: D("2026-08-17T04:00:00Z"),
        endZoneOffsetMinutes: UTC,
      },
    ]
    // Free from 14th 09:00 to 16th 20:00 UTC — the nights of the 14th and 15th
    // only.
    expect(acclimatisedOffsetMinutes(duties, SGT, D("2026-08-16T12:00:00Z"))).toBe(SGT)
  })

  it("with no duty history at all, the crew member is acclimated to home", () => {
    expect(acclimatisedOffsetMinutes([], SGT, D("2026-08-14T00:00:00Z"))).toBe(SGT)
  })
})

describe("para 14(1)(a) — Table A applies within 2 hours of acclimated time", () => {
  it("includes exactly 2 hours — the schedule says 'does not exceed'", () => {
    expect(withinAcclimatisedWindow(SGT, SGT)).toBe(true)
    expect(withinAcclimatisedWindow(SGT, SGT - 120)).toBe(true)
    expect(withinAcclimatisedWindow(SGT, SGT + 120)).toBe(true)
  })

  it("excludes beyond it", () => {
    expect(withinAcclimatisedWindow(SGT, SGT - 121)).toBe(false)
    expect(withinAcclimatisedWindow(SGT, UTC)).toBe(false)
  })

  it("measures against the ACCLIMATED zone, not home", () => {
    // A crew member acclimated to UTC+0 departing UTC+1 is within the window,
    // even though they are eight hours from Singapore.
    expect(withinAcclimatisedWindow(UTC, 60)).toBe(true)
  })
})

describe('"Early start" — scheduled departure 0500 to 0659 acclimated', () => {
  it("covers the stated period inclusively", () => {
    expect(isEarlyStart(4 * 60 + 59)).toBe(false)
    expect(isEarlyStart(5 * 60)).toBe(true)
    expect(isEarlyStart(6 * 60 + 59)).toBe(true)
    expect(isEarlyStart(7 * 60)).toBe(false)
  })
})

describe('"Late finish" — scheduled arrival 0100 to 0159 acclimated', () => {
  it("covers the stated period inclusively", () => {
    expect(isLateFinish(0 * 60 + 59)).toBe(false)
    expect(isLateFinish(1 * 60)).toBe(true)
    expect(isLateFinish(1 * 60 + 59)).toBe(true)
    expect(isLateFinish(2 * 60)).toBe(false)
  })
})

describe('"Window of circadian low" — 0200 to 0459 acclimated', () => {
  it("covers the stated period inclusively", () => {
    expect(isInWindowOfCircadianLow(1 * 60 + 59)).toBe(false)
    expect(isInWindowOfCircadianLow(2 * 60)).toBe(true)
    expect(isInWindowOfCircadianLow(4 * 60 + 59)).toBe(true)
    expect(isInWindowOfCircadianLow(5 * 60)).toBe(false)
  })

  it("does not overlap the early-start window", () => {
    // The two are adjacent but distinct: WOCL ends at 0459, an early start
    // begins at 0500.
    for (let m = 0; m < 1440; m++) {
      expect(isInWindowOfCircadianLow(m) && isEarlyStart(m)).toBe(false)
    }
  })
})

describe("localMinuteOfDay", () => {
  it("converts an instant into the local minute of day", () => {
    expect(localMinuteOfDay(D("2026-08-14T00:00:00Z"), SGT)).toBe(8 * 60)
    expect(localMinuteOfDay(D("2026-08-14T22:00:00Z"), SGT)).toBe(6 * 60) // next day
    expect(localMinuteOfDay(D("2026-08-14T00:00:00Z"), UTC)).toBe(0)
    expect(localMinuteOfDay(D("2026-08-14T02:00:00Z"), -5 * 60)).toBe(21 * 60)
  })
})

describe("duty and rest boundaries — para 7(2) and the rest-period definition", () => {
  it("puts 60 minutes before gate-out and 30 after gate-in inside the duty", () => {
    // "A minimum of 90 minutes must be provided for the completion of
    // pre-flight checks and post-flight checks, which must include allocating a
    // minimum of one hour to the completion of pre-flight checks."
    expect(PRE_FLIGHT_CHECK_MIN).toBe(60)
    expect(POST_FLIGHT_CHECK_MIN).toBe(30)
    expect(PRE_FLIGHT_CHECK_MIN + POST_FLIGHT_CHECK_MIN).toBe(90)
  })

  it("starts rest one hour after the crew member is free of all duties", () => {
    // Not 30 minutes after gate-in, which is what the code used to assume — a
    // duty period ends when free of all duties, and the rest period commences
    // "one hour after that individual is free of all duties".
    expect(REST_STARTS_AFTER_DUTY_MIN).toBe(60)
  })
})

/* ── Acclimatisation applied across a real timeline ──────────────────────── */

describe("applyAcclimatisation — para 14(1)(a) against the earned state", () => {
  const dp = (over: Partial<DutyPeriod>): DutyPeriod =>
    ({
      id: over.id ?? "dp",
      date: "2026-08-14",
      reportTime: "09:00",
      debriefTime: "17:00",
      dutyMinutes: 480,
      flightMinutes: 360,
      sectorCount: 1,
      maxFdpMinutes: 0,
      fdpExtensionUsed: false,
      source: "logbook",
      isFuture: false,
      scheduleEntryIds: [],
      flightIds: [],
      departureTimezoneOffset: 8,
      arrivalTimezoneOffset: 8,
      ...over,
    }) as DutyPeriod

  it("keeps a home-base duty on Table A", () => {
    const [out] = applyAcclimatisation([dp({})])
    expect(out.fdpTableUsed).toBe("A")
  })

  it("puts the first duty out of a far station on Table B", () => {
    // Flew out to UTC+0 yesterday and straight back out today — one night away
    // is not three, so the crew member is still acclimated to Singapore and
    // this departure is 8 hours from their acclimated time.
    const timeline = [
      dp({ id: "out", date: "2026-08-14", departureTimezoneOffset: 8, arrivalTimezoneOffset: 0 }),
      dp({ id: "back", date: "2026-08-15", departureTimezoneOffset: 0, arrivalTimezoneOffset: 8 }),
    ]
    const out = applyAcclimatisation(timeline)
    expect(out[1].fdpTableUsed).toBe("B")
  })

  it("moves to Table A once three consecutive local nights have been spent there", () => {
    // Arrives UTC+0 on the 14th, next duty not until the 19th — the nights of
    // the 14th through 18th are free, so they are now acclimated to UTC+0 and
    // a departure from there is at their acclimated time.
    const timeline = [
      dp({ id: "out", date: "2026-08-14", departureTimezoneOffset: 8, arrivalTimezoneOffset: 0 }),
      dp({ id: "later", date: "2026-08-19", departureTimezoneOffset: 0, arrivalTimezoneOffset: 8 }),
    ]
    const out = applyAcclimatisation(timeline)
    expect(out[1].fdpTableUsed).toBe("A")
  })

  it("does not let a duty's own arrival zone justify its own table", () => {
    // The acclimatised state is evaluated as at the duty's REPORT time, from
    // the duties before it — otherwise landing somewhere would instantly make
    // you acclimated to it.
    const timeline = [
      dp({ id: "first", date: "2026-08-14", departureTimezoneOffset: 8, arrivalTimezoneOffset: 0 }),
    ]
    const out = applyAcclimatisation(timeline)
    expect(out[0].fdpTableUsed).toBe("A") // departed home, acclimated to home
  })
})
