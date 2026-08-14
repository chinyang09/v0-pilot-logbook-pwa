import { describe, expect, it } from "vitest"

import {
  classifyCircadian,
  circadianRestRule,
  CIRCADIAN_REST_MIN,
} from "../regulation-definitions"
import {
  applyAcclimatisation,
  calculateAllRestPeriods,
  calculateRestUntilLegal,
  createDutyPeriodsFromFlights,
} from "../fdp-calculator"
import type { DutyPeriod } from "@/types/entities/roster.types"
import type { FlightLog } from "@/types/entities/flight.types"

/**
 * FIFTH SCHEDULE paragraph 4 — Duty with take-off or landing within the window
 * of circadian low.
 *
 *   4.—(1) An AOC holder who has assigned a person to crew member duty … for a
 *   series of flight duty periods that encompass an early start, a late finish,
 *   or a take-off or landing in the window of circadian low must provide that
 *   person with —
 *     (a) a rest period of 24 hours (inclusive of a local night) prior to the
 *         person commencing duty for the first flight duty period in the
 *         series; and
 *     (b) … the appropriate minimum rest period specified in paragraph 3
 *         between and after each flight duty period in the series.
 *   (2) Where a crew member completes 2 consecutive flight duty periods that
 *   each includes an early start, a late finish, or a take-off or landing in
 *   the window of circadian low, the AOC holder must provide the crew member
 *   with a rest period of 24 hours (inclusive of a local night) prior to the
 *   person commencing the next flight duty period that encompasses an early
 *   start, a late finish, or a take-off or landing in the window of circadian
 *   low.
 *
 * The three terms it reacts to are all defined in the FIRST SCHEDULE, and all
 * of them in ACCLIMATED time — see `regulation-definitions.test.ts` for the
 * boundaries themselves. What is pinned here is that they are read in the right
 * clock, and that the two 24-hour requirements land on the right duties.
 */

const SGT = 8 * 60
const UTC = 0
const D = (iso: string) => Date.parse(iso)

/* ── The classification ──────────────────────────────────────────────────── */

describe("classifyCircadian — read in ACCLIMATED time, not UTC", () => {
  it("calls a 0530 departure an early start for a crew member acclimated there", () => {
    // 21:30Z on the 13th is 05:30 on the 14th in Singapore.
    const c = classifyCircadian({ departureMs: D("2026-08-13T21:30:00Z") }, SGT)
    expect(c.earlyStart).toBe(true)
    expect(c.disruptive).toBe(true)
  })

  it("does not, for a crew member acclimated to a different zone", () => {
    // The same instant is 21:30 for someone acclimated to UTC — an evening
    // departure, and nothing paragraph 4 reacts to. Reading the departure
    // station's local time instead of the acclimated time gets this backwards
    // in both directions.
    const c = classifyCircadian({ departureMs: D("2026-08-13T21:30:00Z") }, UTC)
    expect(c.earlyStart).toBe(false)
    expect(c.disruptive).toBe(false)
  })

  it("calls a 0130 arrival a late finish", () => {
    const c = classifyCircadian({ arrivalMs: D("2026-08-13T17:30:00Z") }, SGT)
    expect(c.lateFinish).toBe(true)
    expect(c.disruptive).toBe(true)
  })

  it("flags a landing inside the window of circadian low", () => {
    // Landing 03:15 SGT.
    const c = classifyCircadian(
      {
        departureMs: D("2026-08-13T15:00:00Z"), // 23:00 SGT — not an early start
        arrivalMs: D("2026-08-13T19:20:00Z"), // 03:20 SGT — not a late finish
        takeoffLandingMs: [D("2026-08-13T15:10:00Z"), D("2026-08-13T19:15:00Z")],
      },
      SGT,
    )
    expect(c.earlyStart).toBe(false)
    expect(c.lateFinish).toBe(false)
    expect(c.woclOperation).toBe(true)
    expect(c.disruptive).toBe(true)
  })

  it("ignores a CRUISE through the window", () => {
    // The window of circadian low is defined "in relation to a take-off or
    // landing" — not to a duty period, and not to the cruise. A sector that
    // gets airborne at 2310 and lands at 0650 is over the window for its whole
    // middle and touches neither end of it.
    const c = classifyCircadian(
      {
        departureMs: D("2026-08-13T15:00:00Z"), // 23:00 SGT
        arrivalMs: D("2026-08-13T23:00:00Z"), // 07:00 SGT
        takeoffLandingMs: [D("2026-08-13T15:10:00Z"), D("2026-08-13T22:50:00Z")],
      },
      SGT,
    )
    expect(c.woclOperation).toBe(false)
    expect(c.disruptive).toBe(false)
  })

  it("says nothing about a duty whose instants are unknown", () => {
    // A LOCAL_STATION schedule report carries times in zones the entry cannot
    // resolve, so it supplies no instants at all. Nothing is the honest answer;
    // guessing would classify a duty against a clock that may be a whole
    // timezone out.
    const c = classifyCircadian({}, SGT)
    expect(c.disruptive).toBe(false)
  })
})

/* ── Which of the two 24-hour requirements applies ───────────────────────── */

describe("circadianRestRule — 4(1)(a) before the first, 4(2) after every two", () => {
  it("asks for nothing before an ordinary duty", () => {
    expect(circadianRestRule(0, false)).toBeNull()
    expect(circadianRestRule(2, false)).toBeNull()
  })

  it("asks for 24 hours before the FIRST of a series — 4(1)(a)", () => {
    expect(circadianRestRule(0, true)).toBe("4a")
  })

  it("asks for nothing before the SECOND — 4(1)(b) hands it back to para 3", () => {
    expect(circadianRestRule(1, true)).toBeNull()
  })

  it("asks for 24 hours again once two consecutive ones are complete — 4(2)", () => {
    expect(circadianRestRule(2, true)).toBe("4b")
  })

  it("is 24 hours either way", () => {
    expect(CIRCADIAN_REST_MIN).toBe(24 * 60)
  })
})

/* ── Across a timeline ───────────────────────────────────────────────────── */

function duty(over: Partial<DutyPeriod>): DutyPeriod {
  return {
    id: over.id ?? "dp",
    date: "2026-08-14",
    reportTime: "04:00",
    debriefTime: "12:00",
    dutyMinutes: 480,
    flightMinutes: 360,
    sectorCount: 2,
    maxFdpMinutes: 780,
    fdpExtensionUsed: false,
    source: "logbook",
    isFuture: false,
    scheduleEntryIds: [],
    flightIds: [],
    departureTimezoneOffset: 8,
    arrivalTimezoneOffset: 8,
    ...over,
  } as DutyPeriod
}

const disruptive = { earlyStart: true, lateFinish: false, woclOperation: false, disruptive: true }
const ordinary = { earlyStart: false, lateFinish: false, woclOperation: false, disruptive: false }

describe("calculateAllRestPeriods — the run of disruptive duties", () => {
  it("requires 24 hours before the first, para 3 before the second, 24 again before the third", () => {
    // Four consecutive early-start duties, each a day apart. Under paragraph 4
    // the pattern is 4(1)(a), then paragraph 3 between the first pair, then
    // 4(2) before the third — which opens a new pair, so the fourth is back on
    // paragraph 3.
    const timeline = [
      duty({ id: "d1", date: "2026-08-14", circadian: disruptive }),
      duty({ id: "d2", date: "2026-08-15", circadian: disruptive }),
      duty({ id: "d3", date: "2026-08-16", circadian: disruptive }),
      duty({ id: "d4", date: "2026-08-17", circadian: disruptive }),
    ]
    const out = calculateAllRestPeriods(timeline)

    // The first duty has no rest before it to measure.
    expect(out[0].restBefore).toBeUndefined()
    expect(out[1].restBefore?.rule).toBe("3a")
    expect(out[2].restBefore?.rule).toBe("4b")
    expect(out[2].restBefore?.requiredRestMinutes).toBe(24 * 60)
    expect(out[3].restBefore?.rule).toBe("3a")
  })

  it("calls 4(1)(a) when the series starts after an ordinary duty", () => {
    const out = calculateAllRestPeriods([
      duty({ id: "d1", date: "2026-08-14", circadian: ordinary }),
      duty({ id: "d2", date: "2026-08-15", circadian: disruptive }),
    ])
    expect(out[1].restBefore?.rule).toBe("4a")
    expect(out[1].restBefore?.requiredRestMinutes).toBe(24 * 60)
  })

  it("an ordinary duty clears the run, so the next disruptive one is a first again", () => {
    const out = calculateAllRestPeriods([
      duty({ id: "d1", date: "2026-08-14", circadian: disruptive }),
      duty({ id: "d2", date: "2026-08-15", circadian: disruptive }),
      duty({ id: "d3", date: "2026-08-16", circadian: ordinary }),
      duty({ id: "d4", date: "2026-08-17", circadian: disruptive }),
    ])
    // Without the reset, d4 would follow two consecutive disruptive duties and
    // read as 4(2) — but an ordinary duty sat between them, so the series
    // ended and d4 begins a new one.
    expect(out[3].restBefore?.rule).toBe("4a")
  })

  it("leaves an all-ordinary timeline entirely to paragraph 3", () => {
    const out = calculateAllRestPeriods([
      duty({ id: "d1", date: "2026-08-14", circadian: ordinary }),
      duty({ id: "d2", date: "2026-08-15", circadian: ordinary }),
      duty({ id: "d3", date: "2026-08-16", circadian: ordinary }),
    ])
    for (const dp of out.slice(1)) {
      expect(dp.restBefore?.rule?.startsWith("3")).toBe(true)
    }
  })

  it("fails a 24-hour requirement that the roster does not give", () => {
    // 12 hours between duties satisfies paragraph 3 comfortably and is half of
    // what 4(1)(a) demands. Reported as compliant, this is a rest period the
    // pilot would have flown on.
    const out = calculateAllRestPeriods([
      duty({ id: "d1", date: "2026-08-14", debriefTime: "12:00", circadian: ordinary }),
      duty({ id: "d2", date: "2026-08-15", reportTime: "01:00", circadian: disruptive }),
    ])
    expect(out[1].restBefore?.rule).toBe("4a")
    expect(out[1].restBefore?.compliant).toBe(false)
  })

  it("accepts one that it does", () => {
    const out = calculateAllRestPeriods([
      duty({ id: "d1", date: "2026-08-14", debriefTime: "12:00", circadian: ordinary }),
      duty({ id: "d2", date: "2026-08-16", reportTime: "04:00", circadian: disruptive }),
    ])
    expect(out[1].restBefore?.rule).toBe("4a")
    expect(out[1].restBefore?.includesLocalNight).toBe(true)
    expect(out[1].restBefore?.compliant).toBe(true)
  })
})

/* ── The figure the dashboard actually shows ─────────────────────────────── */

describe("calculateRestUntilLegal", () => {
  it("asks for 24 hours when the duty AHEAD is disruptive", () => {
    // Para 4 is the one rest rule that turns on the NEXT duty rather than the
    // preceding one, so the countdown has to be given the whole timeline —
    // a past-only list cannot see the early start it is counting down to.
    const r = calculateRestUntilLegal(
      [
        duty({ id: "d1", date: "2026-08-14", debriefTime: "12:00", circadian: ordinary }),
        duty({
          id: "d2",
          date: "2026-08-15",
          reportTime: "21:30",
          isFuture: true,
          circadian: disruptive,
        }),
      ],
      new Date("2026-08-14T14:00:00Z"),
    )
    expect(r?.rule).toBe("4a")
    expect(r?.requiredRestMinutes).toBe(24 * 60)
  })

  it("asks for the ordinary minimum when it is not", () => {
    const r = calculateRestUntilLegal(
      [
        duty({ id: "d1", date: "2026-08-14", debriefTime: "12:00", circadian: ordinary }),
        duty({ id: "d2", date: "2026-08-15", isFuture: true, circadian: ordinary }),
      ],
      new Date("2026-08-14T14:00:00Z"),
    )
    expect(r?.rule).toBe("3a")
    expect(r?.requiredRestMinutes).toBe(10 * 60)
  })

  it("applies para 3's sub-rules together, not as a chain", () => {
    // An 11-hour duty debriefing at 06:30 SGT rests through the working day,
    // so there is no local night: 3(c) alone asks for 11 hours and 3(b) asks
    // for 12. This function kept the if/else chain long after
    // `calculateRestPeriod` lost it, and it is the figure a pilot reads.
    const r = calculateRestUntilLegal(
      [
        duty({
          id: "d1",
          date: "2026-08-14",
          reportTime: "11:30",
          debriefTime: "22:30",
          dutyMinutes: 11 * 60,
          circadian: ordinary,
        }),
      ],
      new Date("2026-08-15T00:00:00Z"),
    )
    expect(r?.rule).toBe("3b")
    expect(r?.requiredRestMinutes).toBe(12 * 60)
  })
})

/* ── End to end, from the flight rows ────────────────────────────────────── */

function flight(over: Partial<FlightLog>): FlightLog {
  return {
    id: over.id ?? "f",
    date: "2026-08-14",
    flightNumber: "TR100",
    aircraftReg: "9V-TNJ",
    aircraftType: "32N",
    departureIcao: "WSSS",
    departureIata: "SIN",
    arrivalIcao: "VTBS",
    arrivalIata: "BKK",
    departureTimezone: 8,
    arrivalTimezone: 8,
    blockTime: "03:00",
    ...over,
  } as FlightLog
}

describe("the instants reach the classification from the flight rows", () => {
  it("classifies a 0530 SGT report as an early start", () => {
    // Gate-out 22:00Z on the 13th is 06:00 SGT on the 14th; the flight is
    // stored on its UTC out date. The duty is built, acclimatised and then
    // classified — nothing along that chain may quietly read the times in the
    // wrong clock.
    const [dp] = applyAcclimatisation(
      createDutyPeriodsFromFlights([
        flight({
          id: "f1",
          date: "2026-08-13",
          scheduledOut: "21:30",
          scheduledIn: "01:00",
          outTime: "21:30",
          offTime: "21:45",
          onTime: "00:45",
          inTime: "01:00",
        }),
      ]),
    )
    // 21:30Z = 05:30 SGT.
    expect(dp.circadian?.earlyStart).toBe(true)
    expect(dp.circadian?.disruptive).toBe(true)
  })

  it("flags a landing in the window of circadian low", () => {
    const [dp] = applyAcclimatisation(
      createDutyPeriodsFromFlights([
        flight({
          id: "f1",
          date: "2026-08-13",
          outTime: "15:00", // 23:00 SGT
          offTime: "15:15",
          onTime: "19:10", // 03:10 SGT — inside 0200–0459
          inTime: "19:25",
        }),
      ]),
    )
    expect(dp.circadian?.woclOperation).toBe(true)
  })

  it("leaves an ordinary daytime duty alone", () => {
    const [dp] = applyAcclimatisation(
      createDutyPeriodsFromFlights([
        flight({
          id: "f1",
          date: "2026-08-14",
          outTime: "02:00", // 10:00 SGT
          offTime: "02:15",
          onTime: "05:00",
          inTime: "05:15",
        }),
      ]),
    )
    expect(dp.circadian?.disruptive).toBe(false)
  })

  it("falls back to the gate times when a flight records no wheels times", () => {
    // Older logbook rows and every PLANNED sector carry out/in and nothing
    // else. Treating those as "no take-off or landing" would classify every
    // one of them as never touching the window — the permissive way to be
    // wrong.
    const [dp] = applyAcclimatisation(
      createDutyPeriodsFromFlights([
        flight({
          id: "f1",
          date: "2026-08-13",
          outTime: "15:00", // 23:00 SGT
          inTime: "19:25", // 03:25 SGT
        }),
      ]),
    )
    expect(dp.circadian?.woclOperation).toBe(true)
  })
})
