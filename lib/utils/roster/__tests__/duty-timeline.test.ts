/**
 * The duty timeline — blocks on one time axis, the rest between them, the
 * sectors inside — and the summary of whatever range is in view.
 */
import { describe, expect, it } from "vitest"
import { buildDutyTimeline, summarizeTimeline } from "../duty-timeline"
import type { DutyPeriod, ScheduleEntry } from "@/types/entities/roster.types"
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
    expect(b2.restBefore).toEqual({
      startMs: at("2026-11-04T01:00:00Z") - 870 * 60_000,
      minutes: 870,
      requiredMinutes: 720,
      compliant: true,
      previousId: "d1",
    })
    // 2026-11-04 09:30 → 2026-11-05 03:00 is 17h30; rest commences an hour
    // after free of all duties, so 16h30, no requirement known.
    expect(b3.restBefore).toEqual({
      startMs: at("2026-11-04T10:30:00Z"),
      minutes: 16.5 * 60,
      requiredMinutes: null,
      compliant: null,
      previousId: "d2",
    })
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

describe("planned against actual", () => {
  it("draws the scheduled block beneath a late one, and the duty as rostered", () => {
    const late = flight({ id: "l", outTime: "02:25", offTime: "02:40", onTime: "04:50", inTime: "05:00" })
    const [b] = buildDutyTimeline([duty({ id: "d", flightIds: ["l"] })], new Map([["l", late]]))
    const s = b.sectors[0]
    expect(s.outMs).toBe(at("2026-11-03T02:25:00Z"))
    expect(s.scheduled).toEqual({ startMs: at("2026-11-03T02:00:00Z"), endMs: at("2026-11-03T04:30:00Z") })
    expect(s.airborne).toEqual({ startMs: at("2026-11-03T02:40:00Z"), endMs: at("2026-11-03T04:50:00Z") })
    // An hour before the scheduled OUT to half an hour after the scheduled IN.
    expect(b.planned).toEqual({ startMs: at("2026-11-03T01:00:00Z"), endMs: at("2026-11-03T05:00:00Z") })
  })

  it("keeps a scheduled OUT before midnight UTC on the day before an actual just after it", () => {
    const f = flight({ id: "m", outTime: "00:10", inTime: "02:40", scheduledOut: "23:50", scheduledIn: "02:20" })
    const [b] = buildDutyTimeline([duty({ id: "d", reportTime: "23:10", flightIds: ["m"] })], new Map([["m", f]]))
    expect(b.sectors[0].scheduled).toEqual({ startMs: at("2026-11-02T23:50:00Z"), endMs: at("2026-11-03T02:20:00Z") })
  })

  it("has no plan for a sector without a schedule, and no airborne span without OFF/ON", () => {
    const f = flight({ id: "h", scheduledOut: "", scheduledIn: "" })
    const [b] = buildDutyTimeline([duty({ id: "d", flightIds: ["h"] })], new Map([["h", f]]))
    expect(b.sectors[0].scheduled).toBeNull()
    expect(b.sectors[0].airborne).toBeNull()
    expect(b.planned).toBeNull()
  })
})

describe("ground duties", () => {
  const entry = (over: Partial<ScheduleEntry>): ScheduleEntry =>
    ({
      id: "g",
      date: "2026-11-04",
      timeReference: "UTC",
      reportTime: "01:00",
      debriefTime: "05:00",
      dutyType: "training",
      dutyCode: "EBT1",
      sectors: [],
      crew: [],
      importedAt: 0,
      ...over,
    }) as ScheduleEntry

  it("draws a UTC training or ground duty in the duty lane, and no rest is measured from it", () => {
    const blocks = buildDutyTimeline(
      [duty({ id: "d1" }), duty({ id: "d2", date: "2026-11-05" })],
      new Map(),
      [entry({}), entry({ id: "o", dutyType: "off" }), entry({ id: "lb", timeReference: "LOCAL_BASE" })],
    )
    expect(blocks.map((b) => b.id)).toEqual(["d1", "g", "d2"])
    const g = blocks[1]
    expect(g.kind).toBe("ground")
    expect(g.code).toBe("EBT1")
    expect(g.dutyMinutes).toBe(240)
    expect(g.restBefore).toBeNull()
    expect(blocks[2].restBefore?.previousId).toBe("d1")
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
