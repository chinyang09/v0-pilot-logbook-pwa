import { describe, expect, it } from "vitest"

import {
  applyAcclimatisation,
  calculateDutyPeriodFromSchedule,
  createDutyPeriodsFromFlights,
  deriveMaxFDP,
  mergeAdjacentDutyPeriods,
} from "../fdp-calculator"
import type { FlightLog } from "@/types/entities/flight.types"
import type { DutyPeriod, ScheduleEntry } from "@/types/entities/roster.types"

/**
 * FIFTH SCHEDULE para 14(1) — which cell of Table A a duty lands in — and para
 * 10(a), which fixes what "the local time of start of the flight duty period"
 * means when reporting is delayed:
 *
 *   10. When a crew member is informed of a delay to the reporting time before
 *   leaving the place of rest, the flight duty period is calculated as follows:
 *     (a) where the delay is less than 4 hours, the maximum permitted flight
 *         duty period is based on the ORIGINAL reporting time but the flight
 *         duty period STARTS at the actual reporting time;
 *
 * So a duty period carries TWO different report times and they do different
 * jobs: `reportTime` is when the duty began and is what `dutyMinutes` is
 * measured from, while `fdpStartLocal` is what the table is entered on. The
 * bug this file exists for was every stage after the producer re-deriving the
 * second from the first.
 */

const f = (o: Partial<FlightLog>): FlightLog =>
  ({
    aircraftReg: "9V-NCJ",
    aircraftType: "A21N",
    departureTimezone: 8,
    arrivalTimezone: 5.5,
    ...o,
  }) as FlightLog

/**
 * The reported duty. TR566/TR567, 12 Dec 25, WSSS–VOTR–WSSS.
 *
 * Scheduled out 14:50Z = 22:50 local at WSSS, so the crew reports an hour
 * earlier at 13:50Z = **21:50 local** — inside Table A's 1500–2159 band, where
 * two sectors is 12¼ hours. The aircraft actually pushed back at 15:13Z, 23
 * minutes late, which puts the ACTUAL report at 22:13 local — inside the next
 * band down, where two sectors is 10¼.
 */
const reportedDuty = [
  f({
    id: "tr566",
    date: "2025-12-12",
    flightNumber: "TR566",
    departureIcao: "WSSS",
    arrivalIcao: "VOTR",
    scheduledOut: "14:50",
    scheduledIn: "19:00",
    outTime: "15:13",
    inTime: "19:30",
    blockTime: "04:17",
  }),
  f({
    id: "tr567",
    date: "2025-12-12",
    flightNumber: "TR567",
    departureIcao: "VOTR",
    arrivalIcao: "WSSS",
    departureTimezone: 5.5,
    arrivalTimezone: 8,
    scheduledOut: "20:15",
    scheduledIn: "00:25",
    outTime: "20:30",
    inTime: "00:40",
    blockTime: "04:10",
  }),
]

describe("the maximum survives every stage of the pipeline", () => {
  const built = createDutyPeriodsFromFlights(reportedDuty)
  const merged = mergeAdjacentDutyPeriods(built)
  const acclimatised = applyAcclimatisation(merged)

  it("enters Table A on the SCHEDULED report time", () => {
    expect(built[0].fdpStartLocal).toBe("21:50")
    // Table A, 1500–2159, 2 sectors = 12¼ hours.
    expect(built[0].maxFdpMinutes).toBe(12 * 60 + 15)
    expect(built[0].fdpTableUsed).toBe("A")
  })

  it("starts the duty at the ACTUAL report time", () => {
    // 15:13Z gate-out less the hour of pre-flight checks, through to 00:40Z
    // plus the half hour of post-flight ones.
    expect(built[0].reportTime).toBe("14:13")
    expect(built[0].debriefTime).toBe("01:10")
    expect(built[0].dutyMinutes).toBe(10 * 60 + 57)
  })

  it("keeps 12:15 through the merge", () => {
    expect(merged).toHaveLength(1)
    expect(merged[0].maxFdpMinutes).toBe(12 * 60 + 15)
  })

  it("keeps 12:15 through the acclimatisation pass", () => {
    // This is the stage that reported 10:15 on the pilot's dashboard. It
    // re-derived the table entry from `reportTime` — 22:13 local — which is
    // the 2200–0559 band, an hour and a half below what the schedule allows.
    expect(acclimatised[0].maxFdpMinutes).toBe(12 * 60 + 15)
    expect(acclimatised[0].fdpTableUsed).toBe("A")
  })

  it("does not report the duty as exceeding its FDP", () => {
    // 10:57 flown against a 12:15 maximum. Against the wrong 10:15 the pilot
    // was shown an exceedance they had not committed.
    expect(acclimatised[0].dutyMinutes).toBeLessThan(acclimatised[0].maxFdpMinutes)
  })
})

describe("deriveMaxFDP is the one derivation", () => {
  const base = (over: Partial<DutyPeriod> = {}): DutyPeriod =>
    ({
      id: "dp",
      date: "2026-08-14",
      reportTime: "14:13",
      debriefTime: "01:10",
      dutyMinutes: 657,
      flightMinutes: 507,
      sectorCount: 2,
      sectorMinutes: [257, 250],
      maxFdpMinutes: 0,
      fdpExtensionUsed: false,
      departureTimezoneOffset: 8,
      source: "logbook",
      isFuture: false,
      scheduleEntryIds: [],
      flightIds: [],
      ...over,
    }) as DutyPeriod

  it("reads the stated basis rather than the report time", () => {
    expect(deriveMaxFDP(base({ fdpStartLocal: "21:50" })).maxFdpMinutes).toBe(735)
  })

  it("falls back to the report time when a duty carries no basis", () => {
    // Duty periods built before the field existed, and hand-built ones in
    // tests. 14:13Z at UTC+8 is 22:13 local, so this is the lower band — the
    // old behaviour, kept so nothing silently loses its figure.
    expect(deriveMaxFDP(base()).maxFdpMinutes).toBe(615)
  })

  it("takes only the acclimatised zone as an override", () => {
    const dp = base({ fdpStartLocal: "21:50", departureTimezoneOffset: 0 })
    // Departing a UTC+0 station while acclimated to Singapore is more than 2
    // hours out, so para 14(1)(b) sends it to Table B.
    expect(deriveMaxFDP(dp, { acclimatedOffset: 8 }).tableUsed).toBe("B")
    // Acclimated to that station, it is Table A — and still on the 21:50 band,
    // not on anything re-derived from the report time.
    const home = deriveMaxFDP(dp, { acclimatedOffset: 0 })
    expect(home.tableUsed).toBe("A")
    expect(home.maxFdpMinutes).toBe(735)
  })

  it("still applies the long-sector adjustment through the same path", () => {
    // Two 8-hour sectors count as 2 each under Table A, so four effective
    // sectors: 1500–2159 gives 10¾ hours.
    const dp = base({
      fdpStartLocal: "21:50",
      sectorCount: 2,
      sectorMinutes: [8 * 60, 8 * 60],
    })
    const r = deriveMaxFDP(dp)
    expect(r.effectiveSectors).toBe(4)
    expect(r.maxFdpMinutes).toBe(10 * 60 + 45)
  })
})

describe("a schedule entry's report time is moved into the DEPARTURE clock", () => {
  const entry = (over: Partial<ScheduleEntry>): ScheduleEntry =>
    ({
      id: "e1",
      date: "2026-08-14",
      timeReference: "UTC",
      reportTime: "13:50",
      debriefTime: "23:00",
      dutyType: "flight",
      sectors: [
        {
          flightNumber: "TR1",
          aircraftType: "32N",
          departureIata: "SIN",
          arrivalIata: "BKK",
          scheduledOut: "14:50",
          scheduledIn: "18:00",
        },
      ],
      crew: [],
      importedAt: 0,
      createdAt: 0,
      syncStatus: "synced",
      ...over,
    }) as ScheduleEntry

  it("shifts a UTC report by the departure offset", () => {
    const dp = calculateDutyPeriodFromSchedule(entry({ timeReference: "UTC" }), 8)
    expect(dp?.fdpStartLocal).toBe("21:50")
  })

  it("shifts a LOCAL_BASE report from Singapore to the departure station", () => {
    const dp = calculateDutyPeriodFromSchedule(
      entry({ timeReference: "LOCAL_BASE", reportTime: "21:50" }),
      0,
    )
    expect(dp?.fdpStartLocal).toBe("13:50")
  })

  it("leaves a LOCAL_STATION report alone", () => {
    // It is ALREADY the local time where the crew member reports. Shifting it
    // again by the departure offset double-counts — the old code did, and on a
    // UTC+0 departure that is an eight-hour error, two bands of Table A.
    const dp = calculateDutyPeriodFromSchedule(
      entry({ timeReference: "LOCAL_STATION", reportTime: "21:50" }),
      0,
    )
    expect(dp?.fdpStartLocal).toBe("21:50")
  })
})

describe("a duty reporting inside a band keeps that band when it runs late", () => {
  // The general shape of the bug, away from the specific flight: any duty
  // scheduled to report shortly before a band boundary and pushed past it.
  it("holds the 0800–1459 band for a 14:45 report that slips to 15:10", () => {
    const [dp] = applyAcclimatisation(
      mergeAdjacentDutyPeriods(
        createDutyPeriodsFromFlights([
          f({
            id: "x",
            date: "2026-08-14",
            departureIcao: "WSSS",
            arrivalIcao: "VTBS",
            departureTimezone: 8,
            arrivalTimezone: 7,
            scheduledOut: "07:45", // 15:45 local, report 14:45 local
            scheduledIn: "10:20",
            outTime: "08:10", // 25 minutes late → 15:10 local report
            inTime: "10:45",
            blockTime: "02:35",
          }),
        ]),
      ),
    )
    expect(dp.fdpStartLocal).toBe("14:45")
    // 0800–1459, 1 sector = 14 hours. The actual report of 15:10 local would
    // have given 13.
    expect(dp.maxFdpMinutes).toBe(14 * 60)
  })
})
