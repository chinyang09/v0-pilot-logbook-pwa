/**
 * What a looked-up flight may write onto a record unprompted: blank fields
 * only, that day's schedule only for the aeroplane, nothing onto a record
 * whose route says it is another flight, nothing onto a simulator, a signed or
 * a locked entry, and never the OOOI times.
 */

import { describe, expect, it } from "vitest"
import type { FlightSuggestion } from "@/lib/lookup/flight-suggest"
import { seedFromNextFlight, seedFromSuggestion, withAirlinePrefix } from "../flight-seed"

const TR288: FlightSuggestion = {
  flightNumber: "TR288",
  date: "2026-10-30",
  basis: "scheduled",
  basedOn: null,
  origin: { icao: "WSSS", iata: "SIN", name: "Singapore Changi" },
  destination: { icao: "RJBB", iata: "KIX", name: "Osaka Kansai" },
  scheduledDeparture: "2026-10-30T02:25:00.000Z",
  scheduledArrival: "2026-10-30T08:55:00.000Z",
  registration: "9V-TNF",
  typecode: "A20N",
  model: "Airbus A320neo",
}

describe("seeding a flight from its flight number and date", () => {
  it("fills every blank it can: the route, the scheduled times in UTC, the aeroplane assigned that day", () => {
    expect(seedFromSuggestion({ date: "2026-10-30", flightNumber: "TR288" }, TR288)).toEqual({
      departureIcao: "WSSS",
      departureIata: "SIN",
      arrivalIcao: "RJBB",
      arrivalIata: "KIX",
      scheduledOut: "02:25",
      scheduledIn: "08:55",
      aircraftReg: "9V-TNF",
      aircraftType: "A20N",
    })
  })

  it("never overwrites what is there, and never writes an OOOI time", () => {
    const patch = seedFromSuggestion(
      { date: "2026-10-30", departureIcao: "WSSS", scheduledOut: "02:30", aircraftReg: "9V-TNA", aircraftType: "A320", outTime: "" },
      TR288
    )
    expect(patch).toEqual({ arrivalIcao: "RJBB", arrivalIata: "KIX", scheduledIn: "08:55" })
    expect(patch).not.toHaveProperty("outTime")
  })

  it("takes nothing onto a record whose route names other airports — it is another flight", () => {
    expect(seedFromSuggestion({ date: "2026-10-30", departureIcao: "WSSS", arrivalIcao: "VTBS" }, TR288)).toEqual({})
    expect(seedFromSuggestion({ date: "2026-10-30", departureIata: "BKK" }, TR288)).toEqual({})
    // Or another date.
    expect(seedFromSuggestion({ date: "2026-10-31" }, TR288)).toEqual({})
  })

  it("takes nothing onto a simulator, a signed or a locked entry", () => {
    expect(seedFromSuggestion({ date: "2026-10-30", entryType: "simulator" }, TR288)).toEqual({})
    expect(seedFromSuggestion({ date: "2026-10-30", isLocked: true }, TR288)).toEqual({})
    expect(seedFromSuggestion({ date: "2026-10-30", signature: { signerName: "x" } as never }, TR288)).toEqual({})
  })

  it("never takes another day's aeroplane: a usual suggestion, or one asked without it", () => {
    const usual = { ...TR288, basis: "usual" as const, basedOn: "2026-10-24", registration: "9V-OFA" }
    expect(seedFromSuggestion({ date: "2026-10-30" }, usual)).not.toHaveProperty("aircraftReg")
    expect(seedFromSuggestion({ date: "2026-10-30" }, TR288, { includeAircraft: false })).not.toHaveProperty("aircraftReg")
    // A day ahead whose aeroplane is not assigned yet fills the rest.
    expect(seedFromSuggestion({ date: "2026-10-30" }, { ...TR288, registration: "" })).toMatchObject({ scheduledOut: "02:25" })
  })
})

describe("seeding a derived leg from what the aeroplane flies next", () => {
  const TR289 = {
    flightNumber: "TR289",
    origin: { icao: "WADD", iata: "DPS", name: "Denpasar" },
    destination: { icao: "WSSS", iata: "SIN", name: "Changi" },
    scheduledDeparture: "2026-10-30T06:20:00.000Z",
    scheduledArrival: "2026-10-30T08:55:00.000Z",
    actualDeparture: null,
    actualArrival: null,
    estimatedArrival: null,
    status: "scheduled" as const,
    arrival: "2026-10-30T08:55:00.000Z",
  }
  const nextLeg = { date: "2026-10-30", departureIcao: "WADD", departureIata: "DPS", arrivalIcao: "", aircraftReg: "9V-TNF" }

  it("fills a next leg's number, far end and scheduled times when the aeroplane's next flight leaves from here", () => {
    expect(seedFromNextFlight(nextLeg, TR289)).toEqual({
      flightNumber: "TR289",
      arrivalIcao: "WSSS",
      arrivalIata: "SIN",
      scheduledOut: "06:20",
      scheduledIn: "08:55",
    })
  })

  it("takes nothing when that flight leaves from somewhere else, or goes elsewhere than a return already says", () => {
    expect(seedFromNextFlight({ ...nextLeg, departureIcao: "WIII", departureIata: "CGK" }, TR289)).toEqual({})
    expect(seedFromNextFlight({ ...nextLeg, arrivalIcao: "VTBS" }, TR289)).toEqual({})
  })

  it("moves a DERIVED leg's date to an overnight return's day, only when asked and only before anything is recorded", () => {
    const tomorrow = { ...TR289, scheduledDeparture: "2026-10-31T01:00:00.000Z", scheduledArrival: "2026-10-31T03:35:00.000Z" }
    expect(seedFromNextFlight(nextLeg, tomorrow)).toEqual({})
    expect(seedFromNextFlight(nextLeg, tomorrow, { allowDate: true })).toMatchObject({ date: "2026-10-31", scheduledOut: "01:00" })
    expect(seedFromNextFlight({ ...nextLeg, outTime: "00:55" }, tomorrow, { allowDate: true })).toEqual({})
    // Two days on is not this leg.
    expect(seedFromNextFlight(nextLeg, { ...tomorrow, scheduledDeparture: "2026-11-01T01:00:00.000Z" }, { allowDate: true })).toEqual({})
  })

  it("gives a digits-only flight number the pilot's airline, and leaves anything else as typed", () => {
    expect(withAirlinePrefix("288", "tr")).toBe("TR288")
    expect(withAirlinePrefix("12a", "TR")).toBe("TR12A")
    expect(withAirlinePrefix("SQ288", "TR")).toBe("SQ288")
    expect(withAirlinePrefix("288", null)).toBe("288")
  })
})
