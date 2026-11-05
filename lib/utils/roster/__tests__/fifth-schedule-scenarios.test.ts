import { describe, expect, it } from "vitest"

/**
 * THE FIFTH SCHEDULE (Regulation 178) and the FIRST SCHEDULE (Regulation 2),
 * clause by clause, as worked scenarios run through the REAL pipeline — the
 * flight rows in, the duty periods, maxima, rests and days off out.
 *
 * Each `describe` names the clause it holds the code to, quoting the words
 * that decide the case. The other suites pin the pieces (the tables cell by
 * cell, the definitions at their boundaries); this one checks that the pieces
 * add up to the regulation when a pilot's month goes through them.
 *
 * Times are UTC unless a comment says SGT (UTC+8). A flight is keyed on the
 * UTC date of its OUT, as everywhere in the app.
 */

import {
  applyAcclimatisation,
  calculateAllRestPeriods,
  calculateMaxFDP,
  calculateRestPeriod,
  calculateRestUntilLegal,
  calculateRollingStats,
  createDutyPeriodsFromFlights,
  fdpMinutesOf,
  getDutyPeriodsFromSchedule,
  isDutyExceedingLimits,
  mergeAdjacentDutyPeriods,
  truncateActivatedStandby,
} from "../fdp-calculator"
import { acclimatisedOffsetMinutes, acclimatisedOffsetsAtEachDuty, containsLocalNight } from "../regulation-definitions"
import { analyseDaysOff, daysOffIn } from "../days-off"
import { buildDutyTimeline, type DutyBlock } from "../duty-timeline"
import { createRollingIndex, rollingAt } from "../rolling-at"
import { DEFAULT_FTL_LIMITS, type DutyPeriod, type ScheduleEntry } from "@/types/entities/roster.types"
import type { FlightLog } from "@/types/entities/flight.types"

const H = 60
const MS_H = 3_600_000
const D = (iso: string) => Date.parse(iso)

/* ── Builders ─────────────────────────────────────────────────────────────── */

function span(out: string, inn: string): string {
  let m = Number(inn.slice(0, 2)) * 60 + Number(inn.slice(3)) - (Number(out.slice(0, 2)) * 60 + Number(out.slice(3)))
  if (m < 0) m += 1440
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
}

/** A flown leg: scheduled = actual unless the case says otherwise. */
function leg(over: Partial<FlightLog> & { id: string; date: string; out: string; in: string }): FlightLog {
  const { out, in: inn, ...rest } = over
  return {
    flightNumber: "TR100",
    aircraftReg: "9V-TNA",
    aircraftType: "A20N",
    departureIcao: "WSSS",
    departureIata: "SIN",
    arrivalIcao: "VTBS",
    arrivalIata: "BKK",
    departureTimezone: 8,
    arrivalTimezone: 7,
    scheduledOut: out,
    scheduledIn: inn,
    outTime: out,
    offTime: "",
    onTime: "",
    inTime: inn,
    blockTime: span(out, inn),
    entryType: "flight",
    isSimulator: false,
    ...rest,
  } as FlightLog
}

/** The FDP page's pipeline, as `computeFDPResult` runs it. */
function pipeline(flights: FlightLog[], extra: DutyPeriod[] = []): DutyPeriod[] {
  const dps = mergeAdjacentDutyPeriods(createDutyPeriodsFromFlights(flights))
  const all = truncateActivatedStandby(
    [...dps, ...extra].sort((a, b) => a.date.localeCompare(b.date) || a.reportTime.localeCompare(b.reportTime)),
  )
  return calculateAllRestPeriods(applyAcclimatisation(all))
}

const byId = (dps: DutyPeriod[], id: string) => dps.find((d) => d.flightIds.includes(id))!

/* ── First Schedule: duty period, FDP, rest period ───────────────────────── */

describe("First Schedule — when a duty, an FDP and a rest period start and end", () => {
  // SIN→BKK→SIN, scheduled out 02:00, last in 09:00.
  const flights = [
    leg({ id: "a", date: "2026-08-10", out: "02:00", in: "04:30" }),
    leg({ id: "b", date: "2026-08-10", out: "05:30", in: "09:00", departureIcao: "VTBS", arrivalIcao: "WSSS", departureTimezone: 7, arrivalTimezone: 8 }),
  ]
  const [dp] = pipeline(flights)

  it("the duty commences at the report — para 7(2)'s hour of pre-flight checks before the scheduled out", () => {
    expect(dp.reportTime).toBe("01:00")
  })

  it('the FDP "finishes when the aircraft finally comes to rest … at the end of the last flight"', () => {
    expect(dp.fdpEndTime).toBe("09:00")
    expect(fdpMinutesOf(dp)).toBe(8 * H)
  })

  it('the duty period "ends when that crew member is free from all duties" — after the post-flight checks', () => {
    expect(dp.debriefTime).toBe("09:30")
    expect(dp.dutyMinutes).toBe(8.5 * H)
  })

  it('a rest period commences "one hour after that individual is free of all duties"', () => {
    const next = leg({ id: "c", date: "2026-08-11", out: "02:00", in: "04:30" })
    const rested = byId(pipeline([...flights, next]), "c")
    // free at 09:30, rest from 10:30, next report 01:00 → 14:30.
    expect(rested.restBefore?.restMinutes).toBe(14.5 * H)
  })
})

/* ── Para 2 and 8: positioning ───────────────────────────────────────────── */

describe("Para 2(1)(b) and para 8 — positioning", () => {
  it("positioning immediately before a flight is IN that flight's FDP, but is not a sector", () => {
    const dps = pipeline([
      leg({ id: "pos", date: "2026-08-10", out: "00:00", in: "02:00", entryType: "positioning" }),
      leg({ id: "op", date: "2026-08-10", out: "03:00", in: "05:00", departureIcao: "VTBS", arrivalIcao: "WSSS" }),
    ])
    const dp = byId(dps, "op")
    expect(dp.flightIds).toContain("pos")
    expect(dp.reportTime).toBe("23:00") // the positioning's report, the day before
    expect(dp.sectorCount).toBe(1)
    expect(dp.flightMinutes).toBe(2 * H)
  })

  it("positioning AFTER the last flight is duty, not FDP — the FDP closes at the last operated on-blocks", () => {
    const dps = pipeline([
      leg({ id: "op", date: "2026-08-10", out: "02:00", in: "05:00" }),
      leg({ id: "pos", date: "2026-08-10", out: "06:00", in: "08:00", entryType: "positioning", departureIcao: "VTBS", arrivalIcao: "WSSS" }),
    ])
    const dp = byId(dps, "op")
    expect(dp.fdpEndTime).toBe("05:00")
    expect(fdpMinutesOf(dp)).toBe(4 * H) // 01:00 → 05:00
    expect(dp.debriefTime).toBe("08:30") // still duty
  })

  it("a duty of positioning alone is a duty period, not a flight duty period — no maximum", () => {
    const [dp] = pipeline([leg({ id: "pos", date: "2026-08-10", out: "02:00", in: "05:00", entryType: "positioning" })])
    expect(dp.dutyKind).toBe("positioning")
    expect(dp.maxFdpMinutes).toBe(0)
    expect(isDutyExceedingLimits(dp, DEFAULT_FTL_LIMITS).exceedsFDP).toBe(false)
  })

  it("positioning the evening before, running into a flight after midnight UTC, is one duty", () => {
    const dps = pipeline([
      leg({ id: "pos", date: "2026-08-10", out: "21:00", in: "23:00", entryType: "positioning" }),
      leg({ id: "op", date: "2026-08-11", out: "00:30", in: "03:30", departureIcao: "VTBS", arrivalIcao: "WSSS" }),
    ])
    const dp = byId(dps, "op")
    expect(dp.flightIds).toEqual(expect.arrayContaining(["pos", "op"]))
    expect(dp.dutyKind ?? "flight").toBe("flight")
    expect(dp.sectorCount).toBe(1)
  })
})

/* ── Para 9: mixed simulator and aircraft flying ─────────────────────────── */

describe("Para 9 — simulator then flying in the same duty", () => {
  const sim = (over: Partial<FlightLog> & { id: string; date: string; out: string; in: string }) =>
    leg({
      ...over,
      entryType: "simulator",
      isSimulator: true,
      aircraftReg: "",
      departureIcao: "",
      arrivalIcao: "",
      departureIata: "",
      arrivalIata: "",
      blockTime: "00:00",
    })

  it('"does not count as a sector", and the FDP "is calculated from the reporting time of the simulator detail"', () => {
    const dps = pipeline([
      sim({ id: "s", date: "2026-08-10", out: "00:00", in: "04:00" }),
      leg({ id: "f", date: "2026-08-10", out: "06:00", in: "08:00" }),
    ])
    const dp = byId(dps, "f")
    expect(dp.flightIds).toContain("s")
    expect(dp.sectorCount).toBe(1)
    expect(dp.reportTime).toBe("00:00")
    // "all the time spent in the [device] is counted in full towards the subsequent FDP"
    expect(fdpMinutesOf(dp)).toBe(8 * H)
    // One sector from a 08:00 SGT start → Table A 0800–1459, 14 hours.
    expect(dp.maxFdpMinutes).toBe(14 * H)
  })

  it("on the timeline the session is duty, named, and adds no flight time while it runs", () => {
    const s = sim({ id: "s", date: "2026-08-10", out: "01:30", in: "07:30" })
    const dps = pipeline([s])
    const blocks = buildDutyTimeline(dps, new Map([[s.id, s]]))
    expect(blocks[0].code).toBe("SIM")
    expect(blocks[0].maxFdpMinutes).toBe(0)
    const index = createRollingIndex(blocks)
    const mid = D("2026-08-10T04:30:00Z")
    expect(rollingAt(index, "flight28", mid)).toBe(0)
    expect(rollingAt(index, "duty14", mid)).toBe(3 * H)
  })

  it("a duty of simulator sessions alone is a duty period, not an FDP — counted in full toward the duty limits", () => {
    const [dp] = pipeline([sim({ id: "s", date: "2026-08-10", out: "01:30", in: "07:30" })])
    expect(dp.dutyKind).toBe("training")
    expect(dp.maxFdpMinutes).toBe(0)
    expect(dp.dutyMinutes).toBe(6 * H)
    expect(dp.sectorCount).toBe(0)
    const stats = calculateRollingStats([dp], new Date("2026-08-10T12:00:00Z"), 14, DEFAULT_FTL_LIMITS)
    expect(stats.dutyHours).toBe(6)
    expect(stats.flightHours).toBe(0)
  })
})

/* ── Para 10: delayed reporting ──────────────────────────────────────────── */

describe("Para 10 — a delay to the reporting time", () => {
  it("(a) under 4 hours: the maximum on the ORIGINAL report, the FDP from the ACTUAL", () => {
    // Rostered report 13:50Z = 21:50 SGT (1500–2159, 2 sectors: 12¼); told to
    // report 30 minutes late at 22:20 SGT, which on its own is 2200–0559 (10¼).
    const [dp] = pipeline([
      leg({ id: "a", date: "2026-08-10", out: "14:50", in: "17:00", reportTime: "14:20" }),
      leg({ id: "b", date: "2026-08-10", out: "18:00", in: "20:00", departureIcao: "VTBS", arrivalIcao: "WSSS" }),
    ])
    expect(dp.reportTime).toBe("14:20")
    expect(dp.maxFdpMinutes).toBe(12.25 * H)
    expect(dp.fdpElapsedAtReport ?? 0).toBe(0)
  })

  it("(b) 4 hours or more: the maximum on the ACTUAL report, the FDP from 4 hours after the original", () => {
    // Rostered report 01:00Z (09:00 SGT), delayed 5h to 06:00Z (14:00 SGT).
    const [dp] = pipeline([
      leg({ id: "a", date: "2026-08-10", out: "02:00", in: "04:00", outTime: "07:00", inTime: "09:00", reportTime: "06:00" }),
    ])
    expect(dp.reportTime).toBe("06:00")
    // The FDP opened at 05:00Z — one hour before the crew member walked in.
    expect(dp.fdpElapsedAtReport).toBe(1 * H)
    // 14:00 SGT is still 0800–1459, one sector: 14 hours.
    expect(dp.maxFdpMinutes).toBe(14 * H)
  })
})

/* ── Para 14: the tables ─────────────────────────────────────────────────── */

describe("Para 14(1) — which table, and the band the FDP starts in", () => {
  const max = (local: string, sectors: number, dep = 8, accl = 8, sectorMinutes?: number[]) =>
    calculateMaxFDP({ reportTimeLocal: local, sectors, departureTimezoneOffset: dep, acclimatedOffset: accl, sectorMinutes })

  it("Table A by local time of start, at every band boundary", () => {
    expect(max("05:59", 1).maxFdpMinutes).toBe(11 * H)
    expect(max("06:00", 1).maxFdpMinutes).toBe(13 * H)
    expect(max("07:59", 1).maxFdpMinutes).toBe(13 * H)
    expect(max("08:00", 1).maxFdpMinutes).toBe(14 * H)
    expect(max("14:59", 2).maxFdpMinutes).toBe(13.25 * H)
    expect(max("15:00", 2).maxFdpMinutes).toBe(12.25 * H)
    expect(max("21:59", 3).maxFdpMinutes).toBe(11.5 * H)
    expect(max("22:00", 3).maxFdpMinutes).toBe(9.5 * H)
    expect(max("10:00", 9).maxFdpMinutes).toBe(9 * H) // 8 or more
  })

  it('Table A where acclimated time and local time at the start differ by "not more than 2 hours", Table B otherwise', () => {
    expect(max("10:00", 1, 7).tableUsed).toBe("A") // BKK, 1h
    expect(max("10:00", 1, 10).tableUsed).toBe("A") // 2h exactly
    expect(max("10:00", 1, 5.5).tableUsed).toBe("B") // VTZ, 2½h
    expect(max("10:00", 2, 0).maxFdpMinutes).toBe(12 * H) // LHR — Table B, 2 sectors
    expect(max("10:00", 6, 0).maxFdpMinutes).toBe(9 * H) // 6 or more
  })

  it("acclimated to London after three nights there, a London departure is Table A", () => {
    expect(max("10:00", 2, 0, 0).tableUsed).toBe("A")
  })

  it("para 14(1A): Table C for a single pilot aeroplane", () => {
    const c = calculateMaxFDP({ reportTimeLocal: "09:00", sectors: 5, crewConfig: "single-pilot" })
    expect(c.tableUsed).toBe("C")
    expect(c.maxFdpMinutes).toBe(10.25 * H)
  })
})

describe("Para 14(2) — long sectors, for a crew of 2 pilots only", () => {
  const a = (sectorMinutes: number[]) =>
    calculateMaxFDP({ reportTimeLocal: "09:00", sectors: sectorMinutes.length, sectorMinutes })

  it('"over 7 but not over 9 hours" counts as 2 under Table A — exactly 7:00 is not over 7', () => {
    expect(a([7 * H]).effectiveSectors).toBe(1)
    expect(a([7 * H + 1]).effectiveSectors).toBe(2)
    expect(a([9 * H]).effectiveSectors).toBe(2)
    expect(a([9 * H + 1]).effectiveSectors).toBe(3)
    expect(a([11 * H + 1]).effectiveSectors).toBe(4)
  })

  it("every long sector counts up: two 8-hour sectors are 4 under Table A (11¾ from 0800)", () => {
    const r = a([8 * H, 8 * H])
    expect(r.effectiveSectors).toBe(4)
    expect(r.maxFdpMinutes).toBe(11.75 * H)
  })

  it("Table B counts them higher: one 10-hour sector from London is 4 sectors, 10½ hours", () => {
    const r = calculateMaxFDP({ reportTimeLocal: "09:00", sectors: 1, sectorMinutes: [10 * H], departureTimezoneOffset: 0 })
    expect(r.effectiveSectors).toBe(4)
    expect(r.maxFdpMinutes).toBe(10.5 * H)
  })
})

describe("Para 15 — augmented flight crew", () => {
  const aug = (augmentedCrew: "plus-one" | "plus-two", inFlightRestFacilities?: boolean) =>
    calculateMaxFDP({ reportTimeLocal: "22:00", sectors: 1, augmentedCrew, inFlightRestFacilities }).maxFdpMinutes

  it("one extra pilot with a rest facility: up to 15 hours; two: up to 18", () => {
    expect(aug("plus-one", true)).toBe(15 * H)
    expect(aug("plus-two", true)).toBe(18 * H)
  })

  it('"no extension … if no rest facilities are available" — nor while it is unknown', () => {
    expect(aug("plus-one", false)).toBe(11 * H)
    expect(aug("plus-one")).toBe(11 * H)
  })
})

/* ── Para 3: minimum rest ────────────────────────────────────────────────── */

describe("Para 3(1) — the minimum rest, every applicable sub-rule at once", () => {
  const duty = (date: string, report: string, debrief: string, minutes: number): DutyPeriod =>
    ({
      id: `${date}${report}`,
      date,
      reportTime: report,
      debriefTime: debrief,
      dutyMinutes: minutes,
      flightMinutes: 0,
      sectorCount: 2,
      maxFdpMinutes: 12 * H,
      fdpExtensionUsed: false,
      source: "logbook",
      isFuture: false,
      scheduleEntryIds: [],
      flightIds: [],
      arrivalTimezoneOffset: 0, // a layover abroad — the night is still SGT's
    }) as DutyPeriod

  it("(a) 10 hours when the rest includes a local night (2200–0800 SGT)", () => {
    // Free 12:00Z, rest from 13:00Z (21:00 SGT) to 23:30Z (07:30 SGT): 10:30,
    // holding 22:00–06:00 SGT.
    const r = calculateRestPeriod(duty("2026-08-11", "23:30", "08:00", 8 * H), duty("2026-08-10", "04:00", "12:00", 8 * H))
    expect(r.includesLocalNight).toBe(true)
    expect(r.requiredRestMinutes).toBe(10 * H)
    expect(r.compliant).toBe(true)
  })

  it("(b) 12 hours when it does not", () => {
    // Rest from 21:00Z (05:00 SGT) to 08:00Z (16:00 SGT): 11h, three hours of night.
    const r = calculateRestPeriod(duty("2026-08-11", "08:00", "16:00", 8 * H), duty("2026-08-10", "12:00", "20:00", 8 * H))
    expect(r.includesLocalNight).toBe(false)
    expect(r.requiredRestMinutes).toBe(12 * H)
    expect(r.compliant).toBe(false)
  })

  it("(c) over 10 and not over 16 hours: at least the duty, rounded up to the next whole hour", () => {
    const after = (minutes: number) =>
      calculateRestPeriod(duty("2026-08-12", "06:00", "14:00", 8 * H), duty("2026-08-10", "04:00", "14:00", minutes))
    expect(after(10 * H).rule).toBe("3a") // exactly 10 has not "exceeded 10"
    expect(after(10 * H + 1).requiredRestMinutes).toBe(11 * H)
    expect(after(13 * H + 20).requiredRestMinutes).toBe(14 * H)
    expect(after(16 * H).requiredRestMinutes).toBe(16 * H)
  })

  it("(c) and (b) together: an 11-hour duty resting without a night needs 12, not 11", () => {
    const r = calculateRestPeriod(duty("2026-08-11", "10:00", "18:00", 8 * H), duty("2026-08-10", "08:00", "19:00", 11 * H))
    expect(r.includesLocalNight).toBe(false)
    expect(r.requiredRestMinutes).toBe(12 * H)
  })

  it('(d) over 16 hours: "at least 24 hours and inclusive of a local night"', () => {
    const prev = duty("2026-08-10", "02:00", "18:30", 16.5 * H)
    const ok = calculateRestPeriod(duty("2026-08-11", "22:00", "06:00", 8 * H), prev)
    expect(ok.requiredRestMinutes).toBe(24 * H)
    expect(ok.rule).toBe("3d")
    expect(ok.compliant).toBe(true)
  })

  it("(d) 24 hours that hold no local night are not enough", () => {
    // Free 18:00Z; rest from 19:00Z (03:00 SGT). 24 hours later is 03:00 SGT
    // again: five hours of one night and five of the next, never eight.
    const prev = duty("2026-08-10", "01:30", "18:00", 16.5 * H)
    const bare = calculateRestPeriod(duty("2026-08-11", "19:00", "03:00", 8 * H), prev)
    expect(bare.restMinutes).toBe(24 * H)
    expect(bare.includesLocalNight).toBe(false)
    expect(bare.compliant).toBe(false)
    // Out to 06:00 SGT, the night is in.
    const withNight = calculateRestPeriod(duty("2026-08-11", "22:00", "06:00", 8 * H), prev)
    expect(withNight.compliant).toBe(true)
  })

  it('a local night is "a period of 8 hours falling between 2200 hours and 0800 hours"', () => {
    const SGT = 8 * 60
    expect(containsLocalNight(D("2026-08-10T16:00:00Z"), D("2026-08-11T00:00:00Z"), SGT)).toBe(true) // 00:00–08:00
    expect(containsLocalNight(D("2026-08-10T14:00:00Z"), D("2026-08-10T22:00:00Z"), SGT)).toBe(true) // 22:00–06:00
    expect(containsLocalNight(D("2026-08-10T15:00:00Z"), D("2026-08-10T22:59:00Z"), SGT)).toBe(false) // 23:00–06:59
  })
})

describe("Para 3 — when am I legal, searched forward", () => {
  it("rest starting in the evening is legal once the local night is in — 11 hours here, not 12", () => {
    // Duty ends 10:00Z (18:00 SGT); rest from 11:00Z (19:00 SGT). Ten hours is
    // 05:00 SGT, but the night (22:00 → 06:00) completes at 06:00 SGT = 22:00Z.
    const flights = [leg({ id: "a", date: "2026-08-10", out: "03:30", in: "09:30" })]
    const r = calculateRestUntilLegal(pipeline(flights), new Date("2026-08-10T12:00:00Z"))!
    expect(r.rule).toBe("3a")
    expect(r.legalAtUtc).toBe("2026-08-10T22:00:00.000Z")
  })

  it("a duty that ran over 16 hours: 24 hours, and the 24 must hold a local night", () => {
    const flights = [
      leg({ id: "a", date: "2026-08-10", out: "01:00", in: "09:00" }),
      leg({ id: "b", date: "2026-08-10", out: "10:00", in: "17:00", departureIcao: "VTBS", arrivalIcao: "WSSS" }),
    ]
    const dps = pipeline(flights)
    expect(dps[0].dutyMinutes).toBe(17.5 * H) // 00:00 report → 17:30 free
    const r = calculateRestUntilLegal(dps, new Date("2026-08-10T20:00:00Z"))!
    expect(r.rule).toBe("3d")
    expect(r.requiredRestMinutes).toBeGreaterThanOrEqual(24 * H)
  })
})

/* ── Para 4: early start, late finish, window of circadian low ────────────── */

describe("Para 4 — a series of duties around the window of circadian low", () => {
  // Early start: scheduled out 21:30Z = 05:30 SGT the next day.
  const early = (id: string, date: string) => leg({ id, date, out: "21:30", in: "23:30" })
  const ordinary = (id: string, date: string) => leg({ id, date, out: "02:00", in: "04:00" })

  it("(1)(a) the series starts after a reset, so an early start mid-block is para 3's", () => {
    // A series is the run of duties between rests of 24 hours inclusive of a
    // local night (the owner's reading): one begins after such a rest, which is
    // what 4(1)(a) asks, and an early start after an ordinary duty inside it is
    // 4(1)(b)'s — paragraph 3.
    const dps = pipeline([ordinary("o", "2026-08-10"), early("e1", "2026-08-11")])
    const e1 = byId(dps, "e1")
    expect(e1.circadian?.earlyStart).toBe(true)
    expect(e1.restBefore?.rule).not.toMatch(/^4/)
  })

  it("(2) is owed before the next early start even past an ordinary duty", () => {
    const dps = pipeline([early("e1", "2026-08-11"), early("e2", "2026-08-12"), ordinary("o", "2026-08-13"), early("e3", "2026-08-14")])
    expect(byId(dps, "o").restBefore?.rule).not.toMatch(/^4/)
    expect(byId(dps, "e3").restBefore?.rule).toBe("4b")
  })

  it("(1)(b) para 3 between the duties of the series; (2) 24 hours again after two in a row", () => {
    const dps = pipeline([
      early("e1", "2026-08-11"),
      early("e2", "2026-08-12"),
      early("e3", "2026-08-13"),
    ])
    expect(byId(dps, "e2").restBefore?.rule).not.toMatch(/^4/)
    expect(byId(dps, "e3").restBefore?.rule).toBe("4b")
    expect(byId(dps, "e3").restBefore?.requiredRestMinutes).toBe(24 * H)
  })

  it('a LATE FINISH is a "scheduled arrival" in 0100–0159 — a delay into that band is not one', () => {
    const late = leg({ id: "l", date: "2026-08-10", out: "13:00", in: "16:20", outTime: "13:50", inTime: "17:10" })
    const [dp] = pipeline([late])
    expect(dp.circadian?.lateFinish).toBe(false)
    const rostered = leg({ id: "r", date: "2026-08-10", out: "14:00", in: "17:20" })
    expect(pipeline([rostered])[0].circadian?.lateFinish).toBe(true)
  })

  it("a take-off or landing in 0200–0459 acclimated time is in the window of circadian low", () => {
    const [dp] = pipeline([leg({ id: "w", date: "2026-08-10", out: "15:00", in: "19:00", offTime: "15:15", onTime: "18:50" })])
    expect(dp.circadian?.woclOperation).toBe(true) // lands 02:50 SGT
  })

  it("a simulator duty between two early starts neither breaks the series nor extends it", () => {
    const sim = leg({
      id: "s", date: "2026-08-12", out: "06:00", in: "10:00", entryType: "simulator", isSimulator: true,
      aircraftReg: "", departureIcao: "", arrivalIcao: "", departureIata: "", arrivalIata: "", blockTime: "00:00",
    })
    const dps = pipeline([early("e1", "2026-08-11"), sim, early("e2", "2026-08-13"), early("e3", "2026-08-14")])
    expect(byId(dps, "e3").restBefore?.rule).toBe("4b")
  })
})

/* ── Para 6: standby ─────────────────────────────────────────────────────── */

describe("Para 6 — standby", () => {
  const entry = (over: Partial<ScheduleEntry>): ScheduleEntry =>
    ({
      id: "sb",
      date: "2026-08-12",
      dutyType: "standby",
      dutyCode: "SBY1",
      reportTime: "00:00",
      debriefTime: "12:00",
      timeReference: "UTC",
      sectors: [],
      crew: [],
      createdAt: 0,
      updatedAt: 0,
      syncStatus: "synced",
      ...over,
    }) as ScheduleEntry

  it("(2)(a) no longer than 18 hours for a flight crew member", () => {
    const [ok] = getDutyPeriodsFromSchedule([entry({ debriefTime: "18:00" })])
    const [over] = getDutyPeriodsFromSchedule([entry({ debriefTime: "18:30" })])
    expect(isDutyExceedingLimits(ok, DEFAULT_FTL_LIMITS).exceeds).toBe(false)
    expect(isDutyExceedingLimits(over, DEFAULT_FTL_LIMITS).exceeds).toBe(true)
  })

  it("(7) only 20% of home standby toward the cumulative duty limits", () => {
    const [sb] = getDutyPeriodsFromSchedule([entry({})])
    expect(sb.countedDutyMinutes).toBe(Math.round(12 * H * 0.2))
  })

  it("(6) a standby ceases on activation — and, by the owner's ruling, it was rest until then", () => {
    const before = leg({ id: "p", date: "2026-08-11", out: "02:00", in: "08:00" })
    const called = leg({ id: "c", date: "2026-08-12", out: "05:00", in: "08:00" })
    const [sb] = getDutyPeriodsFromSchedule([entry({})])
    const dps = pipeline([before, called], [sb])
    const s = dps.find((d) => d.dutyKind === "standby")!
    expect(s.activatedAt).toBe("04:00") // the report of the duty it became
    expect(s.countedDutyMinutes).toBe(Math.round(4 * H * 0.2))
    const c = byId(dps, "c")
    // Free 08:30Z on the 11th, rest from 09:30Z, report 04:00Z: 18:30.
    expect(c.restBefore?.restMinutes).toBe(18.5 * H)
    expect(c.restBefore?.compliant).toBe(true)
  })
})

/* ── Para 12: cumulative duty ────────────────────────────────────────────── */

describe("Para 12(1) — flight crew: 90 hours in 14 days, 180 in 28", () => {
  it("is the flight-crew figure, not the cabin crew's 100 / 200", () => {
    expect(DEFAULT_FTL_LIMITS.maxDuty14Days).toBe(90)
    expect(DEFAULT_FTL_LIMITS.maxDuty28Days).toBe(180)
  })
})

/* ── First Schedule: acclimated ──────────────────────────────────────────── */

describe('First Schedule — "acclimated": 3 consecutive local nights free of duty in a time zone', () => {
  const day = (iso: string, hours: number, zone: number) => ({
    startMs: D(iso),
    endMs: D(iso) + hours * MS_H,
    endZoneOffsetMinutes: zone * 60,
  })

  it("three London nights with a day duty between each acclimate the crew member to London", () => {
    const duties = [
      day("2026-08-10T00:00:00Z", 14, 0), // SIN → LHR, lands 14:00Z
      day("2026-08-11T09:00:00Z", 6, 0), //  day out-and-back from London
      day("2026-08-12T09:00:00Z", 6, 0),
      day("2026-08-13T09:00:00Z", 6, 0), //  after nights of the 10th, 11th, 12th
    ]
    const at = acclimatisedOffsetsAtEachDuty(duties, 8 * 60)
    expect(at).toEqual([480, 480, 480, 0])
    expect(at[3]).toBe(acclimatisedOffsetMinutes(duties.slice(0, 3), 8 * 60, duties[3].startMs))
  })

  it("two nights is not three", () => {
    const duties = [
      day("2026-08-10T00:00:00Z", 14, 0),
      day("2026-08-11T09:00:00Z", 6, 0),
      day("2026-08-12T09:00:00Z", 6, 0),
    ]
    expect(acclimatisedOffsetsAtEachDuty(duties, 8 * 60)[2]).toBe(480)
  })

  it("a night duty breaks the run", () => {
    const duties = [
      day("2026-08-10T00:00:00Z", 14, 0),
      day("2026-08-11T21:00:00Z", 6, 0), // covers the London night of the 11th
      day("2026-08-13T09:00:00Z", 6, 0),
      day("2026-08-14T09:00:00Z", 6, 0),
    ]
    // Nights: 10th, (11th broken), 12th, 13th → a run of 2 by the 14th.
    expect(acclimatisedOffsetsAtEachDuty(duties, 8 * 60)[3]).toBe(480)
  })
})

/* ── Para 5: days off ────────────────────────────────────────────────────── */

describe("Para 5 — days off", () => {
  const block = (startIso: string, hours: number, over: Partial<DutyBlock> = {}): DutyBlock =>
    ({
      id: startIso,
      kind: "flight",
      startMs: D(startIso),
      endMs: D(startIso) + hours * MS_H,
      sectors: [],
      route: "WSSS-VTBS-WSSS",
      maxFdpMinutes: 12 * H,
      ...over,
    }) as DutyBlock

  /** A duty every day from `from` for `n` days, 01:00Z–09:00Z. */
  const daily = (from: string, n: number) =>
    Array.from({ length: n }, (_, i) => block(new Date(D(`${from}T01:00:00Z`) + i * 24 * MS_H).toISOString(), 8))

  it('(1) "at least 34 hours free of all duties including a local night", commencing an hour after the duty', () => {
    const free = D("2026-08-10T10:00:00Z")
    expect(daysOffIn(free, free + 33 * MS_H)).toHaveLength(0)
    expect(daysOffIn(free, free + 34 * MS_H)).toHaveLength(1)
  })

  it("(3) each subsequent day off is at least 24 hours with a local night", () => {
    const free = D("2026-08-10T10:00:00Z") // 18:00 SGT
    // The first ends at +34h, 04:00 SGT — too late in that night window to
    // hold 8 hours, so the second runs to the next night's 06:00 SGT: +60h.
    expect(daysOffIn(free, free + 59 * MS_H)).toHaveLength(1)
    expect(daysOffIn(free, free + 60 * MS_H)).toHaveLength(2)
  })

  it("(4)(a) not more than 7 consecutive days between days off", () => {
    expect(analyseDaysOff(daily("2026-08-01", 7)).findings.filter((f) => f.rule === "5(4)(a)")).toHaveLength(0)
    const eight = analyseDaysOff(daily("2026-08-01", 8)).findings.filter((f) => f.rule === "5(4)(a)")
    expect(eight).toHaveLength(1)
    expect(eight[0].severity).toBe("violation")
  })

  it("(4)(a) a day off resets the count", () => {
    const blocks = [...daily("2026-08-01", 6), ...daily("2026-08-09", 6)] // the 7th–8th free
    expect(analyseDaysOff(blocks).findings.filter((f) => f.rule === "5(4)(a)")).toHaveLength(0)
  })

  it("(4)(b) at least 2 days off in every 2 consecutive weeks", () => {
    // 6 on, 2 off, 6 on, 2 off …: compliant.
    const ok = [...daily("2026-08-01", 6), ...daily("2026-08-10", 6), ...daily("2026-08-19", 6)]
    expect(analyseDaysOff(ok).findings.filter((f) => f.rule === "5(4)(b)")).toHaveLength(0)
    // 7 on, 1 off, 7 on: one day off in the fortnight.
    const short = [...daily("2026-08-01", 7), ...daily("2026-08-09", 7)]
    // the single free day (8th, 09:00Z→1 9th 01:00Z) is 16h — not even one.
    const f = analyseDaysOff(short).findings.filter((x) => x.rule === "5(4)(b)")
    expect(f.length).toBeGreaterThan(0)
  })

  it("(4)(c) fewer than 6 days off in 4 weeks is a violation; 6 or 7 depends on the make-good", () => {
    // Four 6-day blocks with one day off between: 3 days off in ~27 days.
    const blocks = [
      ...daily("2026-08-01", 6),
      ...daily("2026-08-08", 6),
      ...daily("2026-08-15", 6),
      ...daily("2026-08-22", 7),
    ]
    const c = analyseDaysOff(blocks).findings.filter((x) => x.rule === "5(4)(c)")
    expect(c[0]?.severity).toBe("violation")
  })

  it("missing data never produces a violation — a gap reads as days off", () => {
    expect(analyseDaysOff([block("2026-08-01T01:00:00Z", 8), block("2026-09-01T01:00:00Z", 8)]).findings).toEqual([])
  })

  it("(5) back from 7 days or more away: 82 hours with 3 local nights at base before the next FDP", () => {
    const away = [
      block("2026-08-01T01:00:00Z", 14, { route: "WSSS-EGLL" }),
      block("2026-08-04T09:00:00Z", 6, { route: "EGLL-LFPG-EGLL" }),
      block("2026-08-08T20:00:00Z", 14, { route: "EGLL-WSSS" }), // home 10:00Z on the 9th
    ]
    const tooSoon = analyseDaysOff([...away, block("2026-08-11T01:00:00Z", 8)]).findings.filter((f) => f.rule === "5(5)")
    expect(tooSoon).toHaveLength(1)
    const rested = analyseDaysOff([...away, block("2026-08-13T01:00:00Z", 8)]).findings.filter((f) => f.rule === "5(5)")
    expect(rested).toHaveLength(0)
  })
})
