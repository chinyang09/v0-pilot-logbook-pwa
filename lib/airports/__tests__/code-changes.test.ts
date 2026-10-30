/**
 * IATA codes that moved between airports — the table, and the date rule every
 * importer and the stored-flight repair resolve a code through.
 *
 * VTZ: Visakhapatnam's old airport (VOVZ) until 00:01 IST on 17 Aug 2026,
 * Bhogapuram (VOVI) from then. 00:01 IST is 18:31 UTC on the 16th.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  IATA_REASSIGNMENTS,
  airportCodeCorrections,
  flightInstantMs,
  icaoForIataAt,
  icaosForIata,
  isReassignedIata,
  pickAirportAt,
} from "../code-changes"

const at = (iso: string) => Date.parse(iso)

describe("icaoForIataAt", () => {
  it("answers VOVZ before the move and VOVI from its first minute", () => {
    expect(icaoForIataAt("VTZ", at("2026-08-16T18:30:00Z"))).toBe("VOVZ")
    expect(icaoForIataAt("VTZ", at("2026-08-16T18:31:00Z"))).toBe("VOVI")
    expect(icaoForIataAt("vtz", at("2026-10-01T00:00:00Z"))).toBe("VOVI")
    expect(icaoForIataAt("VTZ", at("2019-03-01T00:00:00Z"))).toBe("VOVZ")
  })

  it("is null for a code that never moved — any airport carrying it is the answer", () => {
    expect(icaoForIataAt("SIN", at("2026-09-01T00:00:00Z"))).toBeNull()
    expect(icaoForIataAt("")).toBeNull()
    expect(isReassignedIata("SIN")).toBe(false)
    expect(isReassignedIata("VTZ")).toBe(true)
  })

  it("lists every airport the code has meant, oldest first", () => {
    expect(icaosForIata("VTZ")).toEqual(["VOVZ", "VOVI"])
    expect(icaosForIata("SIN")).toEqual([])
  })
})

describe("flightInstantMs", () => {
  it("reads a UTC clock time on the flight's date, and an earlier arrival as the next day", () => {
    expect(flightInstantMs("2026-08-16", "17:00")).toBe(at("2026-08-16T17:00:00Z"))
    expect(flightInstantMs("2026-08-16", "01:10", "22:40")).toBe(at("2026-08-17T01:10:00Z"))
    expect(flightInstantMs("2026-08-16", "9:05")).toBe(at("2026-08-16T09:05:00Z"))
  })

  it("falls back to the date's noon without a time, and to null without a date", () => {
    expect(flightInstantMs("2026-08-16", "")).toBe(at("2026-08-16T12:00:00Z"))
    expect(flightInstantMs("")).toBeNull()
  })
})

describe("pickAirportAt", () => {
  const airports = new Map([
    ["VTZ", { icao: "VOVI" }],
    ["VOVZ", { icao: "VOVZ" }],
    ["VOVI", { icao: "VOVI" }],
    ["SIN", { icao: "WSSS" }],
  ])

  it("picks the dated airport of a moved code", () => {
    expect(pickAirportAt(airports, "VTZ", at("2026-08-10T04:00:00Z"))?.icao).toBe("VOVZ")
    expect(pickAirportAt(airports, "VTZ", at("2026-08-20T04:00:00Z"))?.icao).toBe("VOVI")
  })

  it("answers nothing rather than the other airport when the dated one is missing", () => {
    const partial = new Map([["VTZ", { icao: "VOVI" }], ["VOVI", { icao: "VOVI" }]])
    expect(pickAirportAt(partial, "VTZ", at("2026-08-10T04:00:00Z"))).toBeUndefined()
  })

  it("uses the code's own entry for a code that never moved, or an unknown instant", () => {
    expect(pickAirportAt(airports, "SIN", at("2026-08-10T04:00:00Z"))?.icao).toBe("WSSS")
    expect(pickAirportAt(airports, "VTZ", null)?.icao).toBe("VOVI")
  })
})

describe("airportCodeCorrections", () => {
  const flight = {
    date: "2026-09-02",
    outTime: "03:10",
    inTime: "05:55",
    departureIata: "SIN",
    departureIcao: "WSSS",
    arrivalIata: "VTZ",
    arrivalIcao: "VOVZ",
  }

  it("moves an arrival after the switch from VOVZ to VOVI", () => {
    expect(airportCodeCorrections(flight)).toEqual([
      { side: "arrival", iata: "VTZ", stored: "VOVZ", correct: "VOVI" },
    ])
  })

  it("moves a departure BEFORE the switch back from VOVI to VOVZ", () => {
    expect(
      airportCodeCorrections({
        date: "2026-08-10",
        outTime: "07:00",
        inTime: "11:30",
        departureIata: "VTZ",
        departureIcao: "VOVI",
        arrivalIata: "SIN",
        arrivalIcao: "WSSS",
      })
    ).toEqual([{ side: "departure", iata: "VTZ", stored: "VOVI", correct: "VOVZ" }])
  })

  it("judges each end at its own instant — an arrival landing after the move", () => {
    // Out 16 Aug 15:00Z, in 19:00Z: departed before 18:31Z, landed after.
    expect(
      airportCodeCorrections({
        date: "2026-08-16",
        outTime: "15:00",
        inTime: "19:00",
        departureIata: "SIN",
        departureIcao: "WSSS",
        arrivalIata: "VTZ",
        arrivalIcao: "VOVZ",
      })
    ).toEqual([{ side: "arrival", iata: "VTZ", stored: "VOVZ", correct: "VOVI" }])
  })

  it("leaves a flight already right, and an ICAO the code never meant", () => {
    expect(airportCodeCorrections({ ...flight, arrivalIcao: "VOVI" })).toEqual([])
    expect(airportCodeCorrections({ ...flight, arrivalIcao: "VOBZ" })).toEqual([])
    expect(airportCodeCorrections({ ...flight, arrivalIcao: "" })).toEqual([])
  })

  it("dates an unflown sector by its scheduled times", () => {
    expect(
      airportCodeCorrections({
        date: "2026-09-02",
        scheduledOut: "03:10",
        scheduledIn: "05:55",
        departureIata: "SIN",
        departureIcao: "WSSS",
        arrivalIata: "VTZ",
        arrivalIcao: "VOVZ",
      })
    ).toEqual([{ side: "arrival", iata: "VTZ", stored: "VOVZ", correct: "VOVI" }])
  })
})

describe("the bundled airport dataset", () => {
  const bundle = JSON.parse(readFileSync(join(process.cwd(), "public/airports.min.json"), "utf8")) as Record<
    string,
    { icao: string; iata: string; tz: string }
  >

  it("carries both airports of every move, in one zone, so a device resolves either offline", () => {
    for (const move of IATA_REASSIGNMENTS) {
      const from = bundle[move.fromIcao]
      const to = bundle[move.toIcao]
      expect(from, move.fromIcao).toBeDefined()
      expect(to, move.toIcao).toBeDefined()
      expect(to.iata).toBe(move.iata)
      // The importers convert a report's local times on the first answer,
      // before the date is known; that is only safe within one zone.
      expect(to.tz).toBe(from.tz)
    }
  })
})
