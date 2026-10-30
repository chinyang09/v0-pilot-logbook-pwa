/**
 * The duty band's one line under the chain says what is TRUE: the next leg's
 * aeroplane when it was found, and otherwise which of "checking", "not asked",
 * "failed" or "not published" it is — a failure never reads as a gate that is
 * merely late.
 */

import { describe, expect, it } from "vitest"
import type { FlightLog } from "@/types/entities/flight.types"
import type { DutyLookups } from "@/hooks/use-duty-lookups"
import { describeDuty } from "../duty-line"

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
            arrival: "2026-10-30T03:00:00Z",
            arrivalGate: "D41",
            arrivalTerminal: "1",
          },
          next: null,
        } as never,
      },
    })
    expect(line(l)).toBe("9V-NCA · Landed 03:00Z · 30m ago · Gate D41 T1 · TR289 from DPS")
    // Once the leg's own gate is drawn under its stop, it is not said twice.
    expect(line({ ...l, gates: { a: gates("D41", "") } })).toBe("9V-NCA · Landed 03:00Z · 30m ago · TR289 from DPS")
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
