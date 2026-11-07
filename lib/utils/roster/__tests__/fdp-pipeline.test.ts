import { describe, expect, it } from "vitest"

import { runFDPPipeline } from "../fdp-pipeline"
import { buildDutyTimeline } from "../duty-timeline"
import { analyseDaysOff } from "../days-off"
import { completePartFlownDuties } from "@/lib/utils/dashboard/planned-duties"
import { deriveDutyStatus } from "@/lib/utils/dashboard/duty-status"
import type { FlightLog } from "@/types/entities/flight.types"

/**
 * The owner's 7 Nov 26 day, as it stood between the sectors: TR490 WSSS→WBKK
 * on blocks, TR491 WBKK→WSSS still a SCHEDULED row (times UTC).
 *
 * The pipeline built duties from flown flights only, and left a part-flown
 * duty out of the duties ahead — so TR491 was nowhere. The duty "ended" at
 * BKI with one sector (a one-sector FDP maximum), the timeline drew one leg,
 * and with the next duty a week later the crew member read as nine days AWAY
 * and back with 18 hours at base: a para 5(5) violation on a day that was
 * a turnaround.
 */

function row(over: Partial<FlightLog> & { id: string }): FlightLog {
  return {
    date: "2026-11-07",
    aircraftReg: "9V-TNI",
    aircraftType: "A20N",
    departureTimezone: 8,
    arrivalTimezone: 8,
    outTime: "",
    offTime: "",
    onTime: "",
    inTime: "",
    blockTime: "00:00",
    entryType: "flight",
    isSimulator: false,
    deletedAt: null,
    ...over,
  } as FlightLog
}

const tr490 = row({
  id: "tr490",
  flightNumber: "TR490",
  departureIcao: "WSSS",
  departureIata: "SIN",
  arrivalIcao: "WBKK",
  arrivalIata: "BKI",
  scheduledOut: "00:40",
  scheduledIn: "02:59",
  outTime: "00:45",
  offTime: "01:04",
  onTime: "03:05",
  inTime: "03:11",
  blockTime: "02:26",
})
const tr491 = row({
  id: "tr491",
  flightNumber: "TR491",
  departureIcao: "WBKK",
  departureIata: "BKI",
  arrivalIcao: "WSSS",
  arrivalIata: "SIN",
  scheduledOut: "04:10",
  scheduledIn: "06:35",
})
// The duty before (5–6 Nov) and the next one (15–16 Nov), both turnarounds.
const before = [
  row({ id: "tr508", date: "2026-11-05", flightNumber: "TR508", departureIcao: "WSSS", arrivalIcao: "RPLC", scheduledOut: "17:25", scheduledIn: "21:05", outTime: "17:41", inTime: "21:21", blockTime: "03:40" }),
  row({ id: "tr509", date: "2026-11-05", flightNumber: "TR509", departureIcao: "RPLC", arrivalIcao: "WSSS", scheduledOut: "22:10", scheduledIn: "01:50", outTime: "22:21", inTime: "02:15", blockTime: "03:54" }),
]
const after = [
  row({ id: "tr560", date: "2026-11-15", flightNumber: "TR560", departureIcao: "WSSS", arrivalIcao: "RPMD", scheduledOut: "17:10", scheduledIn: "20:55" }),
  row({ id: "tr561", date: "2026-11-15", flightNumber: "TR561", departureIcao: "RPMD", arrivalIcao: "WSSS", scheduledOut: "21:55", scheduledIn: "01:30" }),
]
const flights = [...before, tr490, tr491, ...after]
const BETWEEN_SECTORS = Date.parse("2026-11-07T03:30:00Z")

describe("a part-flown duty keeps the sectors still to fly", () => {
  const result = runFDPPipeline(flights, [], new Map(), BETWEEN_SECTORS)
  const duty = result.allDutyPeriods.find((d) => d.flightIds.includes("tr490"))!

  it("is ONE duty of both sectors, ending back at base", () => {
    expect(duty.flightIds).toEqual(["tr490", "tr491"])
    expect(duty.sectorCount).toBe(2)
    expect(duty.route).toBe("WSSS-WBKK-WSSS")
    expect(duty.isFuture).toBeFalsy()
  })

  it("runs to the PLANNED last on-blocks, and its debrief after that", () => {
    expect(duty.fdpEndTime).toBe("06:35")
    expect(duty.debriefTime).toBe("07:05")
  })

  it("takes the two-sector FDP maximum Reg 14 sets by the sectors planned", () => {
    // Table A, report 07:40 SGT (the 0600–0759 band): 1 sector 13:00, 2 sectors
    // 12:15. Read as one sector, the duty was offered 45 minutes it does not have.
    expect(duty.maxFdpMinutes).toBe(735)
  })

  it("counts only what has been FLOWN as flight time", () => {
    expect(duty.flightMinutes).toBe(146)
  })

  it("is not listed twice — the plan does not come back as a duty ahead", () => {
    expect(result.allDutyPeriods.filter((d) => d.flightIds.includes("tr491"))).toHaveLength(1)
  })

  it("draws both legs on the timeline, the second as scheduled", () => {
    const byId = new Map(flights.map((f) => [f.id, f]))
    const block = buildDutyTimeline(result.allDutyPeriods, byId).find((b) => b.sectors.some((s) => s.id === "tr490"))!
    expect(block.sectors.map((s) => [s.id, s.planned])).toEqual([
      ["tr490", false],
      ["tr491", true],
    ])
  })

  it("raises no para 5(5) finding: the crew member never left base for the week", () => {
    const byId = new Map(flights.map((f) => [f.id, f]))
    expect(analyseDaysOff(buildDutyTimeline(result.allDutyPeriods, byId)).findings).toEqual([])
  })
})

describe("completePartFlownDuties", () => {
  it("leaves a wholly flown or wholly planned duty alone", () => {
    const flown = [...before]
    const logged = runFDPPipeline(flown, [], new Map(), BETWEEN_SECTORS).allDutyPeriods
    expect(completePartFlownDuties(logged, flown)).toBe(logged)
  })
})

describe("the dashboard while the last leg is late and not yet on blocks", () => {
  // TR491 was due in at 06:35Z; it is 07:35Z and the sector is not logged.
  const result = runFDPPipeline(flights, [], new Map(), BETWEEN_SECTORS)
  const arrivals = new Map<string, number>([["tr490", Date.parse("2026-11-07T03:11:00Z")]])
  const status = (iso: string) =>
    deriveDutyStatus(result.allDutyPeriods, new Date(iso), null, arrivals, result.plannedDutyPeriods)

  it("is still ON DUTY past the planned debrief — an unlogged sector is not a finished one", () => {
    const s = status("2026-11-07T07:35:00Z")
    expect(s.phase).toBe("on_duty")
    expect(s.active!.sectorCount).toBe(2)
  })

  it("lets go once the FDP could no longer legally run (maximum + the commander's 3 hours)", () => {
    // Report 23:40Z, maximum 12:15, +3:00 → 14:55Z.
    expect(status("2026-11-07T14:50:00Z").phase).toBe("on_duty")
    expect(status("2026-11-07T15:00:00Z").phase).not.toBe("on_duty")
  })

  it("ends at the last on-blocks once that sector is logged", () => {
    const logged = new Map(arrivals).set("tr491", Date.parse("2026-11-07T06:25:00Z"))
    const s = deriveDutyStatus(result.allDutyPeriods, new Date("2026-11-07T07:35:00Z"), null, logged, result.plannedDutyPeriods)
    expect(s.phase).not.toBe("on_duty")
  })
})
