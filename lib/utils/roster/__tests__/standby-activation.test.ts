import { describe, expect, it } from "vitest"

import { standbyActivation } from "../standby-activation"
import type { FlightLog } from "@/types/entities/flight.types"
import type { ScheduleEntry } from "@/types/entities/roster.types"

/**
 * FIFTH SCHEDULE para 6(6) — activation, answered from what the ROSTER PAGE
 * has.
 *
 * The FDP pipeline answers the same question in `truncateActivatedStandby`,
 * working in duty periods. The roster page reads schedule entries and flights
 * and never sees a duty period, so it needs the answer from those — and both
 * go through `findActivationMinute`, so the rule cannot drift into two.
 */

const standby = (over: Partial<ScheduleEntry> = {}): ScheduleEntry =>
  ({
    id: "sb",
    date: "2026-08-14",
    timeReference: "UTC",
    dutyType: "standby",
    dutyCode: "BKUP",
    reportTime: "06:00",
    debriefTime: "18:00",
    sectors: [],
    crew: [],
    importedAt: 0,
    createdAt: 0,
    syncStatus: "synced",
    ...over,
  }) as ScheduleEntry

const flight = (over: Partial<FlightLog>): FlightLog =>
  ({
    id: "f",
    date: "2026-08-14",
    flightNumber: "TR1",
    aircraftReg: "9V-NCJ",
    aircraftType: "A21N",
    departureIcao: "WSSS",
    arrivalIcao: "VTBS",
    departureTimezone: 8,
    arrivalTimezone: 7,
    blockTime: "03:00",
    ...over,
  }) as FlightLog

describe("standbyActivation", () => {
  it("finds the flight that called the standby out", () => {
    // Scheduled out 11:00 → rostered report 10:00, inside the 06:00–18:00
    // window.
    const a = standbyActivation(standby(), [
      flight({ id: "called", scheduledOut: "11:00", outTime: "11:05", inTime: "14:05" }),
    ])
    expect(a).not.toBeNull()
    expect(a!.at).toBe("10:00")
    expect(a!.flightId).toBe("called")
    expect(a!.standbyMinutes).toBe(4 * 60)
  })

  it("returns null when nobody rang", () => {
    expect(standbyActivation(standby(), [])).toBeNull()
  })

  it("ignores a flight reporting outside the window", () => {
    // Rostered report 19:00 — after the standby ended.
    const a = standbyActivation(standby(), [
      flight({ id: "later", scheduledOut: "20:00", outTime: "20:00", inTime: "23:00" }),
    ])
    expect(a).toBeNull()
  })

  it("takes the EARLIEST report inside the window", () => {
    const a = standbyActivation(standby(), [
      flight({ id: "second", scheduledOut: "15:00", outTime: "15:00", inTime: "18:00" }),
      flight({ id: "first", scheduledOut: "09:00", outTime: "09:00", inTime: "12:00" }),
    ])
    expect(a!.flightId).toBe("first")
    expect(a!.at).toBe("08:00")
  })

  it("does not move the activation with a pushback delay", () => {
    // Scheduled out 11:00, actual 13:30. The crew reported at 10:00 as
    // rostered — the aircraft went late underneath them. Deriving the report
    // from the ACTUAL gate-out would put activation at 12:30 and credit two
    // and a half hours of standby that was really duty.
    const a = standbyActivation(standby(), [
      flight({ id: "late", scheduledOut: "11:00", outTime: "13:30", inTime: "16:30" }),
    ])
    expect(a!.at).toBe("10:00")
  })

  it("uses a STATED report when the company moved it", () => {
    const a = standbyActivation(standby(), [
      flight({
        id: "moved",
        scheduledOut: "11:00",
        reportTime: "12:00",
        outTime: "13:00",
        inTime: "16:00",
      }),
    ])
    expect(a!.at).toBe("12:00")
    expect(a!.standbyMinutes).toBe(6 * 60)
  })

  it("handles a standby window that crosses midnight", () => {
    // 22:00 on the 14th → 06:00 on the 15th. A flight reporting 01:00 on the
    // 15th is inside it, even though its clock time reads as "earlier".
    const a = standbyActivation(
      standby({ reportTime: "22:00", debriefTime: "06:00" }),
      [
        flight({
          id: "night",
          date: "2026-08-15",
          scheduledOut: "02:00",
          outTime: "02:00",
          inTime: "05:00",
        }),
      ],
    )
    expect(a).not.toBeNull()
    expect(a!.at).toBe("01:00")
    expect(a!.standbyMinutes).toBe(3 * 60)
  })

  it("says nothing about a duty that is not a standby", () => {
    const a = standbyActivation(standby({ dutyType: "off", reportTime: undefined }), [
      flight({ scheduledOut: "11:00" }),
    ])
    expect(a).toBeNull()
  })
})
