import { describe, expect, it } from "vitest"
import { estimateDutyIn } from "../estimated-in"
import type { FlightLog } from "@/types/entities/flight.types"
import type { FlightTimesLive } from "@/lib/lookup/flight-suggest"

const leg = (id: string, over: Partial<FlightLog>): FlightLog =>
  ({ id, date: "2026-11-25", flightNumber: id, scheduledOut: "", scheduledIn: "", outTime: "", inTime: "", ...over }) as FlightLog
const at = (hhmm: string, day = "2026-11-25") => Date.parse(`${day}T${hhmm}:00Z`)
const live = (over: Partial<FlightTimesLive>): FlightTimesLive => ({
  estimatedDeparture: null,
  actualDeparture: null,
  estimatedArrival: null,
  actualArrival: null,
  source: "tracker",
  ...over,
})

describe("estimateDutyIn", () => {
  // WSSS–VVTS–WSSS: out 05:30, in 07:45; back 08:45–11:00.
  const legs = [
    leg("TR552", { scheduledOut: "05:30", scheduledIn: "07:45" }),
    leg("TR553", { scheduledOut: "08:45", scheduledIn: "11:00" }),
  ]

  it("is the schedule when nothing is known", () => {
    expect(estimateDutyIn(legs, {})).toMatchObject({ ms: at("11:00"), kind: "scheduled", delayMin: 0 })
  })

  it("carries a late first leg into the second — a turnaround is not shortened", () => {
    const e = estimateDutyIn(legs, { TR552: live({ estimatedDeparture: "2026-11-25T06:10:00Z" }) })!
    // 40 minutes late out, the planned 2:15 block, so 40 late in; the return leaves 40 late.
    expect(e.legs[0]).toMatchObject({ outMs: at("06:10"), inMs: at("08:25"), delayMin: 40 })
    expect(e).toMatchObject({ ms: at("11:40"), kind: "estimated", delayMin: 40 })
  })

  it("does not move an early leg's successor earlier than its schedule", () => {
    const e = estimateDutyIn(legs, { TR552: live({ estimatedArrival: "2026-11-25T07:30:00Z" }) })!
    expect(e.legs[0].delayMin).toBe(-15)
    expect(e).toMatchObject({ ms: at("11:00"), kind: "scheduled" })
  })

  it("prefers the logbook, then the source's actual, then its estimate", () => {
    const flown = [
      leg("TR552", { scheduledOut: "05:30", scheduledIn: "07:45", outTime: "05:35", inTime: "07:50" }),
      leg("TR553", { scheduledOut: "08:45", scheduledIn: "11:00", outTime: "09:00" }),
    ]
    // Off blocks at 09:00: OUT + the planned block, unless a source says the arrival.
    expect(estimateDutyIn(flown, {})).toMatchObject({ ms: at("11:15"), kind: "estimated", delayMin: 15 })
    expect(estimateDutyIn(flown, { TR553: live({ estimatedArrival: "2026-11-25T11:05:00Z" }) })).toMatchObject({ ms: at("11:05"), delayMin: 5 })
    expect(estimateDutyIn(flown, { TR553: live({ actualArrival: "2026-11-25T11:02:00Z" }) })).toMatchObject({ ms: at("11:02"), kind: "actual" })
  })

  it("reads an arrival past midnight on the next day, and ignores an estimate before the OUT", () => {
    const night = [leg("TR100", { scheduledOut: "22:00", scheduledIn: "01:30" })]
    expect(estimateDutyIn(night, {})).toMatchObject({ ms: at("01:30", "2026-11-26") })
    expect(estimateDutyIn(night, { TR100: live({ estimatedArrival: "2026-11-25T21:00:00Z" }) })).toMatchObject({ ms: at("01:30", "2026-11-26") })
  })

  it("holds a leg back for a late inbound aeroplane — its arrival plus a turnaround", () => {
    const e = estimateDutyIn(legs, {}, { legId: "TR552", arrivalMs: at("05:20") })!
    // Landing 05:20 + 30 → leaves 05:50, 20 late, carried to the return.
    expect(e.legs[0]).toMatchObject({ outMs: at("05:50"), outKind: "estimated", delayMin: 20 })
    expect(e).toMatchObject({ ms: at("11:20"), kind: "estimated", delayMin: 20 })
    // Landed in good time: the schedule stands.
    expect(estimateDutyIn(legs, {}, { legId: "TR552", arrivalMs: at("04:00") })).toMatchObject({ kind: "scheduled", delayMin: 0 })
  })

  it("is null with no times", () => {
    expect(estimateDutyIn([leg("X", {})], {})).toBeNull()
    expect(estimateDutyIn([], {})).toBeNull()
  })
})
