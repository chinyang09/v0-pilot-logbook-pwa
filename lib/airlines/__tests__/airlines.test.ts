/**
 * Naming an airline: a designator or a name, spelt any way, resolves to one
 * airline; a partial text lists what it could be, the designator first.
 */

import { describe, expect, it } from "vitest"
import { matchAirlines, resolveAirline } from "../airlines"

const ROWS = [
  { name: "Scoot", iata: "TR", icao: "TGW" },
  { name: "Singapore Airlines", iata: "SQ", icao: "SIA" },
  { name: "Scoot Charter", iata: "", icao: "SCX" },
  { name: "Air Asia", iata: "AK", icao: "AXM" },
  { name: "Two Codes A", iata: "XX", icao: "XXA" },
  { name: "Two Codes B", iata: "XX", icao: "XXB" },
]

describe("airlines", () => {
  it("resolves a designator or a name, spelt any way", () => {
    expect(resolveAirline(ROWS, "tr")?.name).toBe("Scoot")
    expect(resolveAirline(ROWS, "TGW")?.name).toBe("Scoot")
    expect(resolveAirline(ROWS, " singapore  AIRLINES ")?.iata).toBe("SQ")
    expect(resolveAirline(ROWS, "AirAsia")?.iata).toBe("AK")
    expect(resolveAirline(ROWS, "XX")).toBeNull()
    expect(resolveAirline(ROWS, "Scoo")).toBeNull()
    expect(resolveAirline(ROWS, "")).toBeNull()
  })

  it("lists what a partial text could be, the designator first", () => {
    expect(matchAirlines(ROWS, "sc").map((a) => a.name)).toEqual(["Scoot", "Scoot Charter"])
    expect(matchAirlines(ROWS, "SQ")[0].name).toBe("Singapore Airlines")
    expect(matchAirlines(ROWS, "asia").map((a) => a.name)).toEqual(["Air Asia"])
    expect(matchAirlines(ROWS, "s")).toEqual([])
  })
})
