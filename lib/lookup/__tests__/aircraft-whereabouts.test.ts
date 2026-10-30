/**
 * "Where is 9V-NCA before my TR288": the last flight it departs on before
 * ours (not ours pushing back a little early), whether it has landed, is in
 * the air or has not left, and the flight after it — said in two lines,
 * relative to now.
 */

import { describe, expect, it } from "vitest"
import type { Fr24Flight } from "@/lib/fr24/types"
import { movementOf, pickWhereabouts, whereaboutsLines, type AircraftWhereabouts } from "../aircraft-whereabouts"

const end = (iata: string, icao: string) => ({ iata, icao, name: iata, timezone: "", gate: "", terminal: "", baggage: "" })
const row = (flightNumber: string, from: string, to: string, dep: string, over: Partial<Fr24Flight> = {}): Fr24Flight => ({
  fr24Id: null,
  flightNumber,
  callsign: "",
  status: "",
  live: false,
  registration: "9V-NCA",
  typecode: "A21N",
  model: "",
  airline: null,
  origin: end(from, ""),
  destination: end(to, ""),
  scheduledDeparture: dep,
  scheduledArrival: new Date(Date.parse(dep) + 3 * 3600_000).toISOString(),
  actualDeparture: null,
  actualArrival: null,
  estimatedArrival: null,
  estimatedDeparture: null,
  durationSeconds: null,
  ...over,
})

// The aeroplane's day, newest first as the list gives it.
const DAY = [
  row("TR288", "SIN", "DPS", "2026-10-30T06:25:00.000Z"),
  row("TR289", "DPS", "SIN", "2026-10-30T00:10:00.000Z", {
    actualDeparture: "2026-10-30T00:18:00.000Z",
    actualArrival: "2026-10-30T03:00:00.000Z",
  }),
  row("TR288", "SIN", "DPS", "2026-10-29T20:30:00.000Z", {
    actualDeparture: "2026-10-29T20:40:00.000Z",
    actualArrival: "2026-10-29T23:20:00.000Z",
  }),
]

describe("aircraft whereabouts", () => {
  it("takes the last flight departing before ours as the inbound, and the one after it as next", () => {
    const { inbound, next } = pickWhereabouts(DAY, Date.parse("2026-10-30T06:25:00Z"))
    expect(inbound?.flightNumber).toBe("TR289")
    expect(next?.scheduledDeparture).toBe("2026-10-30T06:25:00.000Z")
  })

  it("does not take our own flight, pushing back a few minutes early, as the inbound", () => {
    const early = [row("TR288", "SIN", "DPS", "2026-10-30T06:25:00.000Z", { actualDeparture: "2026-10-30T06:15:00.000Z" }), ...DAY.slice(1)]
    expect(pickWhereabouts(early, Date.parse("2026-10-30T06:25:00Z")).inbound?.flightNumber).toBe("TR289")
  })

  it("asked at a leg's arrival, answers the leg itself as inbound and what the aeroplane flies NEXT", () => {
    const { inbound, next } = pickWhereabouts(DAY, Date.parse("2026-10-30T03:01:00Z"))
    expect(inbound?.flightNumber).toBe("TR289")
    expect(next).toMatchObject({ flightNumber: "TR288", origin: { iata: "SIN" }, destination: { iata: "DPS" } })
  })

  it("reads landed, airborne and not yet departed off the times the list carries", () => {
    expect(movementOf(DAY[1])).toMatchObject({ status: "landed", arrival: "2026-10-30T03:00:00.000Z" })
    expect(movementOf(row("TR289", "DPS", "SIN", "2026-10-30T00:10:00.000Z", { actualDeparture: "2026-10-30T00:18:00.000Z", estimatedArrival: "2026-10-30T03:05:00.000Z" })))
      .toMatchObject({ status: "airborne", arrival: "2026-10-30T03:05:00.000Z" })
    expect(movementOf(DAY[0])).toMatchObject({ status: "scheduled", arrival: "2026-10-30T09:25:00.000Z" })
  })

  it("says it in two lines, relative to now — landed, landing, not departed", () => {
    const at = (inbound: AircraftWhereabouts["inbound"]): AircraftWhereabouts => ({ registration: "9V-NCA", typecode: "A21N", at: "", inbound, next: null })
    const landed = { ...movementOf(DAY[1]), arrivalGate: "D41", arrivalTerminal: "1" }
    expect(whereaboutsLines(at(landed), Date.parse("2026-10-30T03:30:00Z"))).toEqual({
      primary: "Landed 03:00Z · 30m ago",
      secondary: "Gate D41 T1 · TR289 from DPS",
    })
    const airborne = { ...landed, status: "airborne" as const, actualArrival: null, arrival: "2026-10-30T03:00:00.000Z", arrivalGate: "", arrivalTerminal: "" }
    expect(whereaboutsLines(at(airborne), Date.parse("2026-10-30T02:30:00Z"), "none")?.primary).toBe("Landing 0300Z · in 30m")
    expect(whereaboutsLines(at(airborne), Date.parse("2026-10-30T03:10:00Z"))?.primary).toBe("Landing 03:00Z · due now")
    expect(whereaboutsLines(at({ ...airborne, status: "scheduled" }), Date.parse("2026-10-30T00:00:00Z"))).toEqual({
      primary: "Due 03:00Z · not departed yet",
      secondary: "TR289 from DPS",
    })
    expect(whereaboutsLines(at(null), 0)).toBeNull()
  })
})
