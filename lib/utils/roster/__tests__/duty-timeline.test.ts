/**
 * The duty timeline — blocks on one time axis, the rest between them, the
 * sectors inside — and the summary of whatever range is in view.
 */
import { describe, expect, it } from "vitest"
import { buildDutyTimeline, summarizeTimeline } from "../duty-timeline"
import type { DutyPeriod } from "@/types/entities/roster.types"
import type { FlightLog } from "@/types/entities/flight.types"

const H = 3_600_000
const at = (iso: string) => Date.parse(iso)

function duty(over: Partial<DutyPeriod>): DutyPeriod {
  return {
    id: "d",
    date: "2026-11-03",
    reportTime: "01:00",
    debriefTime: "09:30",
    dutyMinutes: 510,
    flightMinutes: 300,
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

function flight(over: Partial<FlightLog>): FlightLog {
  return {
    id: "f",
    date: "2026-11-03",
    flightNumber: "TR310",
    departureIcao: "WSSS",
    arrivalIcao: "VTBS",
    aircraftReg: "9V-TNF",
    aircraftType: "A20N",
    outTime: "02:00",
    inTime: "04:30",
    scheduledOut: "02:00",
    scheduledIn: "04:30",
    entryType: "flight",
    ...over,
  } as FlightLog
}

describe("buildDutyTimeline", () => {
  const out = flight({ id: "a" })
  const back = flight({ id: "b", flightNumber: "TR311", departureIcao: "VTBS", arrivalIcao: "WSSS", outTime: "05:30", inTime: "08:00" })
  const byId = new Map([out, back].map((f) => [f.id, f]))

  it("draws a duty from sign-on to sign-off with its sectors in order", () => {
    const [b] = buildDutyTimeline([duty({ id: "d1", flightIds: ["b", "a"] })], byId)
    expect(b.startMs).toBe(at("2026-11-03T01:00:00Z"))
    expect(b.endMs).toBe(at("2026-11-03T09:30:00Z"))
    expect(b.sectors.map((s) => s.flightNumber)).toEqual(["TR310", "TR311"])
    expect(b.route).toBe("WSSS-VTBS-WSSS")
    expect(b.types).toEqual(["A20N"])
    expect(b.restBefore).toBeNull()
  })

  it("puts an IN earlier than OUT on the next day, and an unflown sector on its schedule", () => {
    const night = flight({ id: "n", outTime: "", inTime: "", scheduledOut: "22:00", scheduledIn: "01:30" })
    const [b] = buildDutyTimeline([duty({ id: "d", reportTime: "21:00", flightIds: ["n"] })], new Map([["n", night]]))
    expect(b.sectors[0].planned).toBe(true)
    expect(b.sectors[0].inMs - b.sectors[0].outMs).toBe(3.5 * H)
  })

  it("takes the rest between from the pipeline, else from the gap", () => {
    const first = duty({ id: "d1" })
    const second = duty({
      id: "d2",
      date: "2026-11-04",
      reportTime: "01:00",
      restBefore: { restMinutes: 870, requiredRestMinutes: 720, compliant: true } as DutyPeriod["restBefore"],
    })
    const third = duty({ id: "d3", date: "2026-11-05", reportTime: "03:00" })
    const [, b2, b3] = buildDutyTimeline([third, first, second], new Map())
    expect(b2.restBefore).toEqual({ minutes: 870, requiredMinutes: 720, compliant: true })
    // 2026-11-04 09:30 → 2026-11-05 03:00: 17h30, no requirement known.
    expect(b3.restBefore).toEqual({ minutes: 17.5 * 60, requiredMinutes: null, compliant: null })
  })

  it("flies nothing on a standby and carries no type for a positioning sector", () => {
    const pos = flight({ id: "p", entryType: "positioning" })
    const [sby] = buildDutyTimeline([duty({ id: "s", dutyKind: "standby", flightMinutes: 0 })], new Map())
    const [carried] = buildDutyTimeline([duty({ id: "c", flightIds: ["p"], flightMinutes: 0 })], new Map([["p", pos]]))
    expect(sby.isStandby).toBe(true)
    expect(sby.flightMinutes).toBe(0)
    expect(carried.sectors[0].positioning).toBe(true)
    expect(carried.types).toEqual([])
  })
})

describe("summarizeTimeline", () => {
  const blocks = buildDutyTimeline(
    [
      duty({ id: "d1" }), // 3 Nov 01:00–09:30, 5:00 flown
      duty({
        id: "d2",
        date: "2026-11-04",
        restBefore: { restMinutes: 600, requiredRestMinutes: 720, compliant: false } as DutyPeriod["restBefore"],
      }),
    ],
    new Map(),
  )

  it("adds what the range holds and names the shortest rest and the short ones", () => {
    const s = summarizeTimeline(blocks, at("2026-11-02T00:00:00Z"), at("2026-11-06T00:00:00Z"))
    expect(s).toEqual({ flightMinutes: 600, dutyMinutes: 1020, shortestRestMinutes: 600, shortRests: 1, duties: 2 })
  })

  it("counts only the part of a duty inside the range, never a duty twice", () => {
    const split = at("2026-11-03T05:15:00Z") // halfway through d1
    const left = summarizeTimeline(blocks, at("2026-11-02T00:00:00Z"), split)
    const right = summarizeTimeline(blocks, split, at("2026-11-06T00:00:00Z"))
    expect(left.dutyMinutes + right.dutyMinutes).toBe(1020)
    expect(left.flightMinutes + right.flightMinutes).toBe(600)
  })
})
