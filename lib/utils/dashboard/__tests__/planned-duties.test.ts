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

  it("advises on the FDP remaining", () => {
    const at = new Date("2026-08-14T08:46:00Z")
    const s = deriveDutyStatus(
      pipelineDuties,
      at,
      null,
      undefined,
      buildPlannedDuties([flown, scheduled]),
    )

    // Report 02:35, now 08:46 → 6h11m elapsed.
    expect(s.active?.elapsedMinutes).toBe(371)
    expect(s.active?.maxFdpMinutes).toBeGreaterThan(0)
    expect(s.active?.remainingMinutes).toBeGreaterThan(0)
    // The FDP is the ONLY per-duty ceiling. There used to be a second clock
    // here gauged against a 13-hour "crew duty period" from the account
    // preset — a figure the regulation does not contain. CAAS caps duty over
    // 14 and 28 days and flight time over 28 days and 12 months; per duty
    // there is Reg 14 and nothing else.
    expect(s.active).not.toHaveProperty("maxDutyMinutes")
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

/**
 * Just landed: the three things a pilot wants, and the one question that joins
 * them.
 *
 * "When is my next duty" is not the question — a roster already answers that.
 * The question is whether the rest between the duty just flown and the one
 * rostered next is enough, because a roster can be wrong and the pilot is the
 * only party who will notice in time to say so.
 */
describe("off duty, looking ahead", () => {
  /** Flown 14 Aug, report 02:35, debrief 07:00. */
  const flownDuty = buildPlannedDuties([
    flight({
      id: "done",
      date: "2026-08-14",
      departureIcao: "WSSS",
      arrivalIcao: "VTCC",
      outTime: "03:35",
      inTime: "06:30",
      scheduledOut: "03:35",
      scheduledIn: "06:30",
    }),
  ])

  /** Next duty reports at `reportUtc` on the 15th. */
  const nextDay = (scheduledOut: string) =>
    buildPlannedDuties([
      flight({
        id: "nxt",
        date: "2026-08-15",
        departureIcao: "WSSS",
        arrivalIcao: "VTSP",
        outTime: "",
        inTime: "",
        scheduledOut,
        scheduledIn: "12:00",
        blockTime: "",
      }),
    ])

  /** 08:00Z on the 14th — an hour after debrief. */
  const NOW = new Date("2026-08-14T08:00:00Z")

  /** Rest complete at 18:00Z on the 14th. */
  const rest = {
    isLegalNow: false,
    elapsedMinutes: 60,
    requiredMinutes: 11 * 60,
    legalAtUtc: "2026-08-14T18:00:00Z",
  }

  it("keeps the last duty in view after the post-duty window closes", () => {
    // `justFinished` is nulled after three hours because it decides the phase.
    // What was last flown is still half the picture.
    const late = deriveDutyStatus(flownDuty, new Date("2026-08-14T20:00:00Z"), rest)
    expect(late.phase).toBe("off")
    expect(late.justFinished).toBeNull()
    expect(late.lastDuty).not.toBeNull()
    expect(late.lastDuty!.route).toBe("WSSS-VTCC")
  })

  it("passes a next duty that reports after the rest is complete", () => {
    // Report 03:10 on the 15th, well clear of 18:00 on the 14th.
    const s = deriveDutyStatus(flownDuty, NOW, rest, undefined, nextDay("04:10"))
    expect(s.next!.legalAtReport).toBe(true)
    expect(s.next!.restShortfallMinutes).toBe(0)
  })

  it("flags one that reports INSIDE the rest period, with the shortfall", () => {
    // Scheduled out 16:00 on the 14th → report 15:00, three hours before the
    // rest requirement is met. Nothing else on the panel would say so.
    const s = deriveDutyStatus(
      flownDuty,
      NOW,
      rest,
      undefined,
      buildPlannedDuties([
        flight({
          id: "tooSoon",
          date: "2026-08-14",
          departureIcao: "WSSS",
          arrivalIcao: "VTSP",
          outTime: "",
          inTime: "",
          scheduledOut: "16:00",
          scheduledIn: "18:00",
          blockTime: "",
        }),
      ]),
    )
    expect(s.next!.legalAtReport).toBe(false)
    expect(s.next!.restShortfallMinutes).toBe(3 * 60)
  })

  it("says nothing either way when there is no rest requirement to check", () => {
    const s = deriveDutyStatus(flownDuty, NOW, null, undefined, nextDay("04:10"))
    expect(s.next!.legalAtReport).toBeNull()
    expect(s.next!.restShortfallMinutes).toBe(0)
  })
})

/**
 * The FDP ends at the last ON-BLOCKS, not at the debrief.
 *
 * A duty period runs to being free of all duties, so its window carries the 30
 * minutes of post-flight checks para 7(2) requires. The FDP does not. Keying
 * the panel off the duty window left it reading "Sector 2 of 2 · 2:58 FDP
 * left" for half an hour after the aeroplane was parked and both sectors
 * logged — an FDP counting down that had already stopped.
 */
describe("when the duty stops being ON DUTY", () => {
  const day = [
    flight({
      id: "s1",
      date: "2026-08-15",
      departureIcao: "WSSS",
      arrivalIcao: "ZJHK",
      scheduledOut: "23:07",
      scheduledIn: "02:36",
      outTime: "23:07",
      inTime: "02:36",
      blockTime: "03:29",
    }),
    flight({
      id: "s2",
      date: "2026-08-16",
      departureIcao: "ZJHK",
      arrivalIcao: "WSSS",
      scheduledOut: "03:47",
      scheduledIn: "07:06",
      outTime: "03:47",
      inTime: "07:06",
      blockTime: "03:19",
    }),
  ]

  // The pipeline merges the overnight into one duty; both sectors are on
  // blocks, the last at 07:06Z on the 16th.
  const duties = buildPlannedDuties(day)
  const arrivals = new Map([
    ["s1", Date.parse("2026-08-16T02:36:00Z")],
    ["s2", Date.parse("2026-08-16T07:06:00Z")],
  ])

  it("is on duty right up to the last on-blocks", () => {
    const s = deriveDutyStatus(duties, new Date("2026-08-16T07:00:00Z"), null, arrivals)
    expect(s.phase).toBe("on_duty")
  })

  it("is NOT on duty in the post-flight half hour", () => {
    // 07:17Z — eleven minutes after the last arrival, and inside the duty
    // window, which runs to the 07:36 debrief. This is the reported case.
    const s = deriveDutyStatus(duties, new Date("2026-08-16T07:17:00Z"), null, arrivals)
    expect(s.phase).not.toBe("on_duty")
    expect(s.active).toBeNull()
    expect(s.lastDuty).not.toBeNull()
  })

  it("stays on duty while a sector is still unlogged", () => {
    // Only the first sector has landed. The second has not, so the duty is
    // still running however far past its planned debrief it goes — an unlogged
    // sector is not a finished one.
    const partial = new Map([["s1", Date.parse("2026-08-16T02:36:00Z")]])
    const s = deriveDutyStatus(duties, new Date("2026-08-16T07:17:00Z"), null, partial)
    expect(s.phase).toBe("on_duty")
  })

  it("carries the next duty's own length and maximum", () => {
    const nextDay = buildPlannedDuties([
      flight({
        id: "n1",
        date: "2026-08-17",
        departureIcao: "WSSS",
        arrivalIcao: "VOCB",
        outTime: "",
        inTime: "",
        scheduledOut: "12:30",
        scheduledIn: "16:50",
        blockTime: "",
      }),
    ])
    const s = deriveDutyStatus(
      duties,
      new Date("2026-08-16T09:00:00Z"),
      null,
      arrivals,
      [...duties, ...nextDay],
    )
    // Report 11:30, debrief 17:20 — 5h50m planned, against its Reg 14 maximum.
    expect(s.next!.plannedDutyMinutes).toBe(5 * 60 + 50)
    expect(s.next!.maxFdpMinutes).toBeGreaterThan(0)
  })
})
