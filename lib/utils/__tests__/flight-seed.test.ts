/**
 * What a looked-up flight may write onto a record unprompted: blank fields
 * only, that day's schedule only for the aeroplane, nothing onto a record
 * whose route says it is another flight, nothing onto a simulator, a signed or
 * a locked entry, and never the OOOI times.
 */

import { describe, expect, it } from "vitest"
import type { FlightSuggestion } from "@/lib/lookup/flight-suggest"
import { afterPrefill, lookupPatch, ownedAfter, seedFromNextFlight, seedFromSuggestion, withAirlinePrefix } from "../flight-seed"

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

describe("an explicit lookup over an earlier one", () => {
  const TR289: FlightSuggestion = {
    ...TR288,
    flightNumber: "TR289",
    origin: { icao: "RJBB", iata: "KIX", name: "Osaka Kansai" },
    destination: { icao: "WSSS", iata: "SIN", name: "Singapore Changi" },
    scheduledDeparture: "2026-10-30T10:00:00.000Z",
    scheduledArrival: "2026-10-30T16:30:00.000Z",
    registration: "",
    typecode: "32Q",
  }

  it("288 then 289: what 288 wrote moves with the number, and 288's aeroplane goes", () => {
    const blankFlight = { date: "2026-10-30", flightNumber: "TR288" }
    const first = lookupPatch(blankFlight, TR288)
    expect(first.conflicts).toEqual([])
    const after288 = { ...blankFlight, ...first.patch, flightNumber: "TR289" }
    const owned = ownedAfter(blankFlight, {}, first.patch)

    const second = lookupPatch(after288, TR289, owned)
    expect(second.patch).toEqual({
      departureIcao: "RJBB",
      departureIata: "KIX",
      arrivalIcao: "WSSS",
      arrivalIata: "SIN",
      scheduledOut: "10:00",
      scheduledIn: "16:30",
      aircraftReg: "",
      aircraftType: "",
    })
    expect(second.conflicts).toEqual([])
  })

  it("keeps what the pilot changed after the lookup, and offers it as a replacement", () => {
    const first = lookupPatch({ date: "2026-10-30" }, TR288)
    const owned = ownedAfter({ date: "2026-10-30" }, {}, first.patch)
    const edited = { date: "2026-10-30", ...first.patch, scheduledOut: "02:40" }
    const second = lookupPatch(edited, { ...TR288, scheduledDeparture: "2026-10-30T02:30:00.000Z" }, owned)
    expect(second.patch).not.toHaveProperty("scheduledOut")
    expect(second.conflicts).toEqual(["scheduledOut"])
    expect(lookupPatch(edited, { ...TR288, scheduledDeparture: "2026-10-30T02:30:00.000Z" }, owned, { overwrite: true }).patch).toMatchObject({
      scheduledOut: "02:30",
    })
  })

  it("a route the pilot entered is another flight until they say replace", () => {
    const own = { date: "2026-10-30", departureIcao: "WSSS", arrivalIcao: "VTBS" }
    const looked = lookupPatch(own, TR288)
    expect(looked.patch).toEqual({})
    // Only what the pilot actually wrote differs; a blank is not a difference.
    expect(looked.conflicts).toEqual(["arrivalIcao"])
    expect(lookupPatch(own, TR288, {}, { overwrite: true }).patch).toMatchObject({ arrivalIcao: "RJBB" })
  })

  it("a blank that completes the pilot's own entry is filled, and spelling is not a difference", () => {
    const own = { date: "2026-10-30", departureIcao: "wsss", arrivalIata: "KIX", aircraftReg: "9VTNF", scheduledOut: "02:25" }
    const looked = lookupPatch(own, TR288)
    expect(looked.conflicts).toEqual([])
    expect(looked.patch).toMatchObject({ departureIata: "SIN", arrivalIcao: "RJBB", aircraftType: TR288.typecode })
    expect(looked.patch).not.toHaveProperty("aircraftReg")
    expect(looked.patch).not.toHaveProperty("departureIcao")
  })

  it("another aeroplane the pilot entered is a difference; its type is not filled from the other one", () => {
    const looked = lookupPatch({ date: "2026-10-30", aircraftReg: "9V-OFH" }, TR288)
    expect(looked.conflicts).toEqual(["aircraftReg"])
    expect(looked.patch).not.toHaveProperty("aircraftType")
  })

  it("usual times fill the route and times, never the aeroplane; nothing onto a locked entry", () => {
    const usual = { ...TR288, basis: "usual" as const, basedOn: "2026-11-06", registration: "" }
    expect(lookupPatch({ date: "2026-10-30" }, usual).patch).toMatchObject({ arrivalIcao: "RJBB", scheduledOut: "02:25" })
    expect(lookupPatch({ date: "2026-10-30" }, usual).patch).not.toHaveProperty("aircraftReg")
    expect(lookupPatch({ date: "2026-10-30", isLocked: true }, TR288)).toEqual({ patch: {}, conflicts: [] })
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

describe("the airline shown in an empty Flight #", () => {
  it("is added to digits and replaced by a designator", () => {
    expect(afterPrefill("TR", "TR2", "TR")).toBe("TR2")
    // Typing the code out of habit, one key at a time, and pasting it whole.
    expect(afterPrefill("TR", "TRT", "TR")).toBe("T")
    expect(afterPrefill("TR", "TRTR288", "TR")).toBe("TR288")
    expect(afterPrefill("TR", "TRSQ12", "TR")).toBe("SQ12")
  })

  it("leaves everything else as typed", () => {
    expect(afterPrefill("TR2", "TR28", "TR")).toBe("TR28")
    expect(afterPrefill("TR", "T", "TR")).toBe("T")
    expect(afterPrefill("TR", "TRS", undefined)).toBe("TRS")
  })
})
