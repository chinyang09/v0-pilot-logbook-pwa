/**
 * The duty timeline — blocks on one time axis, the rest between them, the
 * sectors inside — and the summary of whatever range is in view.
 */
import { describe, expect, it } from "vitest"
import { buildDutyTimeline } from "../duty-timeline"
import { SCENARIO_DUTY_PREFIX } from "../fdp-calculator"
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
      restBefore: { restMinutes: 870, requiredRestMinutes: 720, compliant: true, rule: "3b", includesLocalNight: false } as DutyPeriod["restBefore"],
    })
    const third = duty({ id: "d3", date: "2026-11-05", reportTime: "03:00" })
    const [, b2, b3] = buildDutyTimeline([third, first, second], new Map())
    expect(b2.restBefore).toEqual({
      signOffMs: at("2026-11-03T09:30:00Z"),
      startMs: at("2026-11-04T01:00:00Z") - 870 * 60_000,
      minutes: 870,
      requiredMinutes: 720,
      minimumEndMs: at("2026-11-04T01:00:00Z") - 150 * 60_000,
      compliant: true,
      status: "ok",
      previousId: "d1",
      rule: "3b",
      includesLocalNight: false,
    })
    // 2026-11-04 09:30 → 2026-11-05 03:00 is 17h30; rest commences an hour
    // after free of all duties, so 16h30, no requirement known.
    expect(b3.restBefore).toEqual({
      signOffMs: at("2026-11-04T09:30:00Z"),
      startMs: at("2026-11-04T10:30:00Z"),
      minutes: 16.5 * 60,
      requiredMinutes: null,
      minimumEndMs: null,
      compliant: null,
      status: null,
      previousId: "d2",
      rule: null,
      includesLocalNight: null,
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
    // An hour before the scheduled OUT to half an hour after the scheduled IN.
    expect(b.planned).toEqual({ startMs: at("2026-11-03T01:00:00Z"), endMs: at("2026-11-03T05:00:00Z") })
  })

  it("keeps a scheduled OUT before midnight UTC on the day before an actual just after it", () => {
    const f = flight({ id: "m", outTime: "00:10", inTime: "02:40", scheduledOut: "23:50", scheduledIn: "02:20" })
    const [b] = buildDutyTimeline([duty({ id: "d", reportTime: "23:10", flightIds: ["m"] })], new Map([["m", f]]))
    expect(b.sectors[0].scheduled).toEqual({ startMs: at("2026-11-02T23:50:00Z"), endMs: at("2026-11-03T02:20:00Z") })
  })

  it("has no plan for a sector without a schedule", () => {
    const f = flight({ id: "h", scheduledOut: "", scheduledIn: "" })
    const [b] = buildDutyTimeline([duty({ id: "d", flightIds: ["h"] })], new Map([["h", f]]))
    expect(b.sectors[0].scheduled).toBeNull()
    expect(b.planned).toBeNull()
  })
})

describe("against the limits", () => {
  it("flags an FDP past its maximum, and one in its last tenth", () => {
    const [over] = buildDutyTimeline([duty({ id: "o", fdpEndTime: "09:00", maxFdpMinutes: 450 })], new Map())
    const [near] = buildDutyTimeline([duty({ id: "n", fdpEndTime: "09:00", maxFdpMinutes: 500 })], new Map())
    const [fine] = buildDutyTimeline([duty({ id: "f", fdpEndTime: "09:00", maxFdpMinutes: 780 })], new Map())
    expect(over.fdpMinutes).toBe(480)
    expect([over.limit, near.limit, fine.limit]).toEqual(["over", "near", null])
  })

  it("calls a rest short below its requirement and tight within an hour of it", () => {
    const rest = (restMinutes: number, compliant: boolean) =>
      buildDutyTimeline(
        [duty({ id: "a" }), duty({ id: "b", date: "2026-11-04", restBefore: { restMinutes, requiredRestMinutes: 720, compliant } as DutyPeriod["restBefore"] })],
        new Map(),
      )[1].restBefore?.status
    expect([rest(700, false), rest(750, true), rest(900, true)]).toEqual(["short", "tight", "ok"])
  })
})

describe("the maximum and the minimum", () => {
  it("puts the FDP's limit at the last on-blocks moved by the FDP still in hand, drawn only for a duty to come", () => {
    // 01:00–09:30, last on-blocks 09:00: an FDP of 8:00 against a 13:00 maximum.
    const flown = duty({ id: "f", fdpEndTime: "09:00" })
    const planned = duty({ id: "p", date: "2026-11-10", fdpEndTime: "09:00", isFuture: true })
    const [a, b] = buildDutyTimeline([flown, planned], new Map())
    expect(a.fdpEndMs).toBe(a.endMs - 0.5 * H)
    expect(a.fdpLimitMs).toBe(a.fdpEndMs + 5 * H)
    expect(a.showMax).toBe(false)
    expect(b.showMax).toBe(true)
    // Over: the limit falls BEFORE the last on-blocks — the breach is the FDP's
    // last hour, not the post-flight half hour after it.
    const [over] = buildDutyTimeline([duty({ id: "o", fdpEndTime: "09:00", maxFdpMinutes: 420 })], new Map())
    expect(over.fdpLimitMs).toBe(over.fdpEndMs - 1 * H)
    expect(over.limit).toBe("over")
  })

  it("has no maximum on a standby", () => {
    const [s] = buildDutyTimeline([duty({ id: "s", dutyKind: "standby", maxFdpMinutes: 0, isFuture: true })], new Map())
    expect(s.fdpLimitMs).toBeNull()
    expect(s.showMax).toBe(false)
  })

  it("ends the minimum rest at its requirement, past the sign-on when short", () => {
    const first = duty({ id: "d1" })
    const short = duty({
      id: "d2",
      date: "2026-11-03",
      reportTime: "19:30",
      restBefore: { restMinutes: 540, requiredRestMinutes: 720, compliant: false } as DutyPeriod["restBefore"],
    })
    const [, b] = buildDutyTimeline([first, short], new Map())
    expect(b.restBefore!.minimumEndMs! - b.startMs).toBe(3 * H)
  })

  it("draws a what-if duty's flying inside it, from the end of the pre-flight checks", () => {
    const what = duty({ id: `${SCENARIO_DUTY_PREFIX}c1__`, isFuture: true, flightMinutes: 240 })
    const [b] = buildDutyTimeline([what], new Map())
    expect(b.scenario).toBe(true)
    expect(b.showMax).toBe(true)
    expect(b.sectors).toHaveLength(1)
    expect(b.sectors[0].outMs).toBe(b.startMs + H)
    expect(b.sectors[0].inMs - b.sectors[0].outMs).toBe(4 * H)
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
