import { describe, expect, it } from "vitest"

import { buildPlannedDuties } from "../planned-duties"
import { deriveDutyStatus } from "../duty-status"
import type { FlightLog } from "@/types/entities/flight.types"

/**
 * The reported case, end to end: a two-sector day with sector one flown and
 * sector two still a SCHEDULED flight row.
 *
 * The FDP pipeline filters to `isFlownFlight` before building duty periods, so
 * the unflown sector contributed nothing and the duty appeared to end at the
 * first arrival. With no roster import either, there was no plan anywhere and
 * the dashboard reported "Roster Clear" and started counting down rest — while
 * the pilot was between sectors.
 */

function flight(over: Partial<FlightLog>): FlightLog {
  return {
    id: over.id ?? "f",
    date: "2026-08-14",
    departureIcao: "WSSS",
    arrivalIcao: "VTCC",
    blockTime: "02:55",
    ...over,
  } as FlightLog
}

/** TR110 — flown: WSSS→VTCC, 03:35–06:30. */
const flown = flight({
  id: "tr110",
  flightNumber: "TR110",
  departureIcao: "WSSS",
  arrivalIcao: "VTCC",
  outTime: "03:35",
  inTime: "06:30",
  scheduledOut: "03:35",
  scheduledIn: "06:30",
})

/** TR111 — scheduled only: VTCC→WSSS, 07:40–10:30. No OOOI yet. */
const scheduled = flight({
  id: "tr111",
  flightNumber: "TR111",
  departureIcao: "VTCC",
  arrivalIcao: "WSSS",
  outTime: "",
  inTime: "",
  scheduledOut: "07:40",
  scheduledIn: "10:30",
  blockTime: "",
})

describe("buildPlannedDuties", () => {
  it("spans the whole day, flown sector plus the one still scheduled", () => {
    const [dp] = buildPlannedDuties([flown, scheduled])

    expect(dp.sectorCount).toBe(2)
    expect(dp.route).toBe("WSSS-VTCC-WSSS")
    // A duty period runs from report to being free of ALL duties, and para
    // 7(2) puts 90 minutes of checks around the flying with at least 60 of
    // them before it. So report is an hour before the first gate-out and
    // debrief is 30 minutes after the last gate-in — which here is the
    // SCHEDULED arrival of sector two.
    expect(dp.reportTime).toBe("02:35")
    expect(dp.debriefTime).toBe("11:00")
  })

  it("computes the FDP maximum for the sectors PLANNED, not the one flown", () => {
    const [twoSector] = buildPlannedDuties([flown, scheduled])
    const [oneSector] = buildPlannedDuties([flown])

    expect(twoSector.sectorCount).toBe(2)
    expect(oneSector.sectorCount).toBe(1)
    // More sectors can only reduce the allowance, never raise it.
    expect(twoSector.maxFdpMinutes).toBeLessThanOrEqual(oneSector.maxFdpMinutes)
  })

  it("ignores rows that describe no aircraft movement", () => {
    const sim = flight({ id: "sim", isSimulator: true, outTime: "01:00", inTime: "05:00" })
    const empty = flight({ id: "blank", outTime: "", inTime: "", scheduledOut: "", scheduledIn: "" })
    const binned = flight({ id: "gone", outTime: "01:00", inTime: "02:00", deletedAt: Date.now() })

    expect(buildPlannedDuties([sim, empty, binned])).toEqual([])
  })

  it("leaves the original flight rows untouched", () => {
    // Everything else in the app reads these, and an unflown sector must keep
    // looking unflown to them.
    buildPlannedDuties([flown, scheduled])
    expect(scheduled.outTime).toBe("")
    expect(scheduled.inTime).toBe("")
  })
})

describe("the reported case, through deriveDutyStatus", () => {
  /** What the FDP pipeline produces: only the flown sector. */
  const pipelineDuties = buildPlannedDuties([flown])
  /** Which legs are on blocks — the hook builds this from the flight rows. */
  const arrivals = new Map([["tr110", Date.parse("2026-08-14T06:30:00Z")]])

  it("reads ON DUTY between the two sectors", () => {
    const at = new Date("2026-08-14T08:46:00Z") // 16:46 GMT+8, between sectors
    const s = deriveDutyStatus(
      pipelineDuties,
      at,
      null,
      arrivals,
      buildPlannedDuties([flown, scheduled]),
      13 * 60,
    )

    expect(s.phase).toBe("on_duty")
    expect(s.active?.sectorCount).toBe(2)
    expect(s.active?.legs.map((l) => l.status)).toEqual(["complete", "active"])
  })

  it("without the plan it counts down rest — the reported bug", () => {
    const at = new Date("2026-08-14T08:46:00Z")
    const s = deriveDutyStatus(pipelineDuties, at)
    expect(s.phase).not.toBe("on_duty")
  })

  it("advises on BOTH the FDP and the crew duty period remaining", () => {
    const at = new Date("2026-08-14T08:46:00Z")
    const s = deriveDutyStatus(
      pipelineDuties,
      at,
      null,
      undefined,
      buildPlannedDuties([flown, scheduled]),
      13 * 60,
    )

    // Report 02:35, now 08:46 → 6h11m elapsed.
    expect(s.active?.elapsedMinutes).toBe(371)
    expect(s.active?.maxDutyMinutes).toBe(780)
    expect(s.active?.dutyRemainingMinutes).toBe(409) // 13:00 − 6:11
    expect(s.active?.maxFdpMinutes).toBeGreaterThan(0)
    expect(s.active?.remainingMinutes).toBeGreaterThan(0)
  })

  it("reports no duty cap rather than inventing one when none is configured", () => {
    const at = new Date("2026-08-14T08:46:00Z")
    const s = deriveDutyStatus(
      pipelineDuties,
      at,
      null,
      undefined,
      buildPlannedDuties([flown, scheduled]),
    )
    expect(s.active?.maxDutyMinutes).toBe(0)
    expect(s.active?.dutyExceeded).toBe(false)
  })
})

/**
 * The reported case, second round: a duty that is ENTIRELY still to come.
 *
 * Both sectors are scheduled rows with no OOOI. The pipeline drops them
 * (`isFlownFlight`), and with no roster imported there is nothing else — so the
 * only source of the duty is `buildPlannedDuties`. The dashboard consulted the
 * plan for the ACTIVE case and never for the NEXT one, so a pilot with a
 * report half an hour away was shown "OFF DUTY · Roster Clear · Next report —".
 */
describe("a duty that has not started yet", () => {
  // TR644 WSSS→VTSP 04:10–06:15, then TR645 VTSP→WSSS 07:15–09:25, all
  // scheduled. Report is an hour before the first gate-out: 03:10Z.
  const scheduledDay = [
    flight({
      id: "tr644",
      date: "2026-08-15",
      flightNumber: "TR644",
      departureIcao: "WSSS",
      arrivalIcao: "VTSP",
      outTime: "",
      inTime: "",
      scheduledOut: "04:10",
      scheduledIn: "06:15",
      blockTime: "",
    }),
    flight({
      id: "tr645",
      date: "2026-08-15",
      flightNumber: "TR645",
      departureIcao: "VTSP",
      arrivalIcao: "WSSS",
      outTime: "",
      inTime: "",
      scheduledOut: "07:15",
      scheduledIn: "09:25",
      blockTime: "",
    }),
  ]

  const plan = buildPlannedDuties(scheduledDay)
  /** 02:40Z — half an hour before report. */
  const NOW = new Date("2026-08-15T02:40:00Z")

  it("builds a plan for the day", () => {
    expect(plan).toHaveLength(1)
    expect(plan[0].reportTime).toBe("03:10")
    expect(plan[0].sectorCount).toBe(2)
  })

  it("reports the next duty even though nothing is flown or rostered", () => {
    // The pipeline has NOTHING — every sector is unflown, so `isFlownFlight`
    // filtered them all out.
    const s = deriveDutyStatus([], NOW, null, undefined, plan)
    expect(s.next).not.toBeNull()
    expect(s.next!.inMinutes).toBe(30)
    expect(s.next!.sectorCount).toBe(2)
    expect(s.next!.route).toBe("WSSS-VTSP-WSSS")
  })

  it("is still OFF duty until the report", () => {
    const s = deriveDutyStatus([], NOW, null, undefined, plan)
    expect(s.phase).toBe("off")
  })

  it("becomes the active duty once the report passes", () => {
    const s = deriveDutyStatus(
      [],
      new Date("2026-08-15T04:00:00Z"),
      null,
      undefined,
      plan,
    )
    expect(s.phase).toBe("on_duty")
  })

  it("does not double-count a plan that the pipeline already covers", () => {
    // Once the day is flown, the pipeline duty and the plan describe the same
    // duty. The next-duty search must not offer the plan's copy as a second
    // one.
    const tomorrow = deriveDutyStatus(
      [
        {
          id: "logged",
          date: "2026-08-15",
          reportTime: "03:10",
          debriefTime: "09:55",
          dutyMinutes: 405,
          flightMinutes: 255,
          sectorCount: 2,
          maxFdpMinutes: 735,
          fdpExtensionUsed: false,
          source: "logbook",
          isFuture: false,
          scheduleEntryIds: [],
          flightIds: ["tr644", "tr645"],
        },
      ],
      NOW,
      null,
      undefined,
      plan,
    )
    expect(tomorrow.next!.id).toBe("logged")
  })
})
