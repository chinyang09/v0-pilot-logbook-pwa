import { describe, expect, it } from "vitest"

import { createDutyPeriodsFromFlights } from "../fdp-calculator"
import type { FlightLog } from "@/types/entities/flight.types"

/**
 * FIFTH SCHEDULE paragraph 10 — Delayed reporting time.
 *
 *   10. When a crew member is informed of a delay to the reporting time before
 *   leaving the place of rest, the flight duty period is calculated as follows:
 *     (a) where the delay is less than 4 hours, the maximum permitted flight
 *         duty period is based on the ORIGINAL reporting time but the flight
 *         duty period STARTS at the actual reporting time;
 *     (b) where the delay is 4 hours or more, the maximum permitted flight duty
 *         period is based on the ACTUAL reporting time but the flight duty
 *         period STARTS 4 hours after the original reporting time;
 *
 * The original reporting time is the scheduled gate-out less the hour para 7(2)
 * allows for pre-flight checks. It is also the DEFAULT for when the duty began:
 * a late aircraft under a crew who reported on time is the ordinary case, and
 * it does not move the report.
 */

const f = (o: Partial<FlightLog>): FlightLog =>
  ({
    aircraftReg: "9V-NCJ",
    aircraftType: "A21N",
    departureIcao: "WSSS",
    arrivalIcao: "VTBS",
    departureTimezone: 8,
    arrivalTimezone: 7,
    date: "2026-08-14",
    flightNumber: "TR1",
    ...o,
  }) as FlightLog

/** Scheduled 06:00Z–09:00Z, so the rostered report is 05:00Z (13:00 local). */
const base = {
  scheduledOut: "06:00",
  scheduledIn: "09:00",
  blockTime: "03:00",
}

describe("the report defaults to the ROSTERED time", () => {
  it("does not move when the aircraft goes late", () => {
    const [dp] = createDutyPeriodsFromFlights([
      f({ id: "a", ...base, outTime: "07:30", inTime: "10:30" }),
    ])
    // Ninety minutes late off the gate, but nobody moved the report.
    expect(dp.reportTime).toBe("05:00")
    // 05:00 → 10:30 + the half hour of post-flight checks.
    expect(dp.dutyMinutes).toBe(6 * 60)
  })

  it("falls back to the gate-out when there is no schedule at all", () => {
    // A hand-entered flight with no scheduled times has nothing else to go on.
    const [dp] = createDutyPeriodsFromFlights([
      f({ id: "b", outTime: "07:30", inTime: "10:30", blockTime: "03:00" }),
    ])
    expect(dp.reportTime).toBe("06:30")
  })
})

describe("para 10(a) — a delay of less than 4 hours", () => {
  const [dp] = createDutyPeriodsFromFlights([
    f({
      id: "c",
      ...base,
      // Told to stay at home: report slips two hours, to 07:00Z.
      reportTime: "07:00",
      outTime: "08:00",
      inTime: "11:00",
    }),
  ])

  it("starts the flight duty period at the ACTUAL report", () => {
    expect(dp.reportTime).toBe("07:00")
    // 07:00 → 11:00 + post-flight checks.
    expect(dp.dutyMinutes).toBe(4 * 60 + 30)
  })

  it("bases the maximum on the ORIGINAL report", () => {
    // 05:00Z is 13:00 local at WSSS — Table A's 0800–1459 band, where one
    // sector is 14 hours. Read from the actual 07:00Z report (15:00 local) it
    // would be the 1500–2159 band and 13 hours.
    expect(dp.fdpStartLocal).toBe("13:00")
    expect(dp.maxFdpMinutes).toBe(14 * 60)
  })

  it("has spent none of the FDP before reporting", () => {
    expect(dp.fdpElapsedAtReport).toBe(0)
  })
})

describe("para 10(b) — a delay of 4 hours or more", () => {
  const [dp] = createDutyPeriodsFromFlights([
    f({
      id: "d",
      ...base,
      // Report slips five hours, from 05:00Z to 10:00Z.
      reportTime: "10:00",
      outTime: "11:00",
      inTime: "14:00",
    }),
  ])

  it("still starts the DUTY period when the crew member reports", () => {
    // The duty period is defined by the First Schedule as starting when the
    // crew member reports; para 10 speaks only about the flight duty period.
    expect(dp.reportTime).toBe("10:00")
    expect(dp.dutyMinutes).toBe(4 * 60 + 30)
  })

  it("re-bases the maximum on the ACTUAL report", () => {
    // 10:00Z is 18:00 local — the 1500–2159 band, one sector, 13 hours. Under
    // 10(a)'s rule it would have kept the original 13:00 local and 14 hours.
    expect(dp.fdpStartLocal).toBe("18:00")
    expect(dp.maxFdpMinutes).toBe(13 * 60)
  })

  it("counts the FDP as already running from 4 hours after the original", () => {
    // The window opened at 09:00Z — an hour before the crew member reported —
    // so an hour of it is gone before the duty period even starts. This is the
    // punitive half of para 10 and the reason the branch matters.
    expect(dp.fdpElapsedAtReport).toBe(60)
  })
})

describe("the boundary is at exactly 4 hours", () => {
  const at = (reportTime: string) =>
    createDutyPeriodsFromFlights([
      f({ id: "e", ...base, reportTime, outTime: "12:00", inTime: "15:00" }),
    ])[0]

  it("treats 3h59m as 10(a)", () => {
    const dp = at("08:59")
    expect(dp.fdpStartLocal).toBe("13:00") // original
    expect(dp.fdpElapsedAtReport).toBe(0)
  })

  it("treats exactly 4h as 10(b) — 'a delay of 4 hours or more'", () => {
    const dp = at("09:00")
    expect(dp.fdpStartLocal).toBe("17:00") // actual, 09:00Z = 17:00 local
    expect(dp.fdpElapsedAtReport).toBe(0) // exactly 4h: the window opens as they report
  })
})

describe("a stated report earlier than the roster", () => {
  it("is taken at face value and is not a para 10 delay", () => {
    // Called out early, or simply a report the company set further ahead of
    // departure than the hour of para 7(2). Either way the duty started then.
    const [dp] = createDutyPeriodsFromFlights([
      f({ id: "g", ...base, reportTime: "04:30", outTime: "06:00", inTime: "09:00" }),
    ])
    expect(dp.reportTime).toBe("04:30")
    expect(dp.dutyMinutes).toBe(5 * 60)
    // No delay, so the maximum stays on the rostered report.
    expect(dp.fdpStartLocal).toBe("13:00")
    expect(dp.fdpElapsedAtReport).toBe(0)
  })
})

describe("a multi-sector duty", () => {
  it("takes the report from whichever sector carries one", () => {
    const [dp] = createDutyPeriodsFromFlights([
      f({
        id: "h1",
        scheduledOut: "06:00",
        scheduledIn: "09:00",
        reportTime: "07:00",
        outTime: "08:00",
        inTime: "11:00",
        blockTime: "03:00",
      }),
      f({
        id: "h2",
        departureIcao: "VTBS",
        arrivalIcao: "WSSS",
        scheduledOut: "10:00",
        scheduledIn: "13:00",
        outTime: "12:00",
        inTime: "15:00",
        blockTime: "03:00",
      }),
    ])
    expect(dp.sectorCount).toBe(2)
    expect(dp.reportTime).toBe("07:00")
    // Two sectors from the 0800–1459 band: 13¼ hours.
    expect(dp.maxFdpMinutes).toBe(13 * 60 + 15)
  })
})
