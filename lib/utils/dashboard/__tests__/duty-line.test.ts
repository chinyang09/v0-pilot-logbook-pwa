/**
 * The duty band's one line under the chain says what is TRUE: the next leg's
 * aeroplane when it was found, and otherwise which of "checking", "not asked",
 * "failed" or "not published" it is — a failure never reads as a gate that is
 * merely late.
 */

import { describe, expect, it } from "vitest"
import type { FlightLog } from "@/types/entities/flight.types"
import type { DutyLookups } from "@/hooks/use-duty-lookups"
import { acrossTurns, describeDuty } from "../duty-line"

const legs = [{ id: "a" }, { id: "b" }] as FlightLog[]
const gates = (dep: string, arr: string) =>
  ({
    status: "done",
    gates: { flight: {}, departure: { airport: "SIN", gate: dep, terminal: "" }, arrival: { airport: "DPS", gate: arr, terminal: "", baggage: "" }, source: "board" },
  }) as never
const lookups = (over: Partial<DutyLookups>): DutyLookups => ({
  gates: {},
  inbound: null,
  inboundRegistration: "9V-NCA",
  inboundFlightId: "a",
  onward: null,
  ...over,
})
const line = (l: DutyLookups | null, loading = false) => describeDuty(legs, l, loading, () => {}).line

describe("the duty band's line", () => {
  it("names the aeroplane where it was found", () => {
    const now = Date.parse("2026-10-30T03:30:00Z")
    const l = lookups({
      inbound: {
        status: "done",
        checkedAt: now,
        whereabouts: {
          registration: "9V-NCA",
          inbound: {
            flightNumber: "TR289",
            status: "landed",
            origin: { icao: "WADD", iata: "DPS" },
            destination: { icao: "WSSS", iata: "SIN" },
            departure: "2026-10-30T00:30:00Z",
            scheduledDeparture: "2026-10-30T00:10:00Z",
            arrival: "2026-10-30T03:00:00Z",
            arrivalGate: "D41",
            arrivalTerminal: "1",
          },
          next: null,
        } as never,
      },
    })
    expect(line(l)).toBe("9V-NCA · TR289 from DPS · Gate D41 · STD 00:10Z · Landed 03:00Z · 30m ago")
    // Once the leg's own gate is drawn under its stop, it is not said twice.
    expect(line({ ...l, gates: { a: gates("D41", "") } })).toBe("9V-NCA · TR289 from DPS · STD 00:10Z · Landed 03:00Z · 30m ago")
  })

  it("says checking while it asks, and not asked when it has not", () => {
    expect(line(null, true)).toBe("Checking gates and aircraft…")
    expect(line(null)).toBe("Gates and aircraft not checked yet")
  })

  it("never calls a failure late", () => {
    expect(line(lookups({ inbound: { status: "failed" } }))).toMatch(/unavailable/)
    expect(line(lookups({ inboundRegistration: "", inboundFlightId: null, gates: { a: { status: "failed" }, b: { status: "failed" } } }))).toMatch(
      /unavailable/
    )
  })

  it("tells published gates from none yet when there is no aeroplane to ask after", () => {
    const noAircraft = { inboundRegistration: "", inboundFlightId: null }
    expect(line(lookups({ ...noAircraft, gates: { a: gates("C11", ""), b: gates("", "") } }))).toBe("Gates on the route above")
    expect(line(lookups({ ...noAircraft, gates: { a: gates("", ""), b: gates("", "") } }))).toBe("Gates not published yet")
    expect(describeDuty(legs, lookups({ gates: { a: gates("C11", "") } }), false, () => {}).legGates).toEqual([
      { dep: "C11", arr: "" },
      { dep: "", arr: "" },
    ])
  })

  it("says so when the registration has no flights", () => {
    expect(line(lookups({ inbound: { status: "missing" } }))).toBe("9V-NCA · no recent flights found")
  })
})

describe("gates across a short turn (the owner: 698 goes into 699's gate)", () => {
  const leg = (o: Partial<FlightLog>) => ({ id: o.flightNumber, date: "2026-11-26", aircraftReg: "", ...o }) as FlightLog
  const out = leg({ flightNumber: "TR698", departureIcao: "WSSS", arrivalIcao: "VTCC", scheduledOut: "04:35", scheduledIn: "07:50" })
  const back = leg({ flightNumber: "TR699", departureIcao: "VTCC", arrivalIcao: "WSSS", scheduledOut: "09:40", scheduledIn: "12:55" })

  it("gives the arrival the next leg's departure gate, marked as taken from it", () => {
    const g = acrossTurns([out, back], [{ dep: "C11", arr: "" }, { dep: "B14", arr: "" }])
    expect(g[0]).toEqual({ dep: "C11", arr: "B14", arrFrom: "TR699" })
    expect(g[1]).toEqual({ dep: "B14", arr: "" })
  })

  it("gives the departure the leg before's arrival gate", () => {
    const g = acrossTurns([out, back], [{ dep: "C11", arr: "B12" }, { dep: "", arr: "" }])
    expect(g[1]).toEqual({ dep: "B12", arr: "", depFrom: "TR698" })
  })

  it("never overwrites a published gate", () => {
    const g = acrossTurns([out, back], [{ dep: "C11", arr: "B12" }, { dep: "B14", arr: "" }])
    expect(g[0].arr).toBe("B12")
    expect(g[1].dep).toBe("B14")
    expect(g[0].arrFrom).toBeUndefined()
  })

  it("takes nothing across a long turn, another airport or another aeroplane", () => {
    const late = { ...back, scheduledOut: "11:30" }
    expect(acrossTurns([out, late], [{ dep: "", arr: "" }, { dep: "B14", arr: "" }])[0].arr).toBe("")
    const elsewhere = { ...back, departureIcao: "VTBS" }
    expect(acrossTurns([out, elsewhere], [{ dep: "", arr: "" }, { dep: "B14", arr: "" }])[0].arr).toBe("")
    const swap = [{ ...out, aircraftReg: "9V-NCB" }, { ...back, aircraftReg: "9V-NCK" }]
    expect(acrossTurns(swap, [{ dep: "", arr: "" }, { dep: "B14", arr: "" }])[0].arr).toBe("")
    const same = [{ ...out, aircraftReg: "9V-NCB" }, { ...back, aircraftReg: "9VNCB" }]
    expect(acrossTurns(same, [{ dep: "", arr: "" }, { dep: "B14", arr: "" }])[0].arr).toBe("B14")
  })

  it("reads a turn across midnight on its schedule", () => {
    const redEye = leg({ flightNumber: "TR274", date: "2026-11-18", departureIcao: "WSSS", arrivalIcao: "WIII", scheduledOut: "23:55", scheduledIn: "01:50" })
    const ret = leg({ flightNumber: "TR275", date: "2026-11-19", departureIcao: "WIII", arrivalIcao: "WSSS", scheduledOut: "02:35", scheduledIn: "04:25" })
    expect(acrossTurns([redEye, ret], [{ dep: "", arr: "" }, { dep: "D3", arr: "" }])[0].arr).toBe("D3")
  })
})
