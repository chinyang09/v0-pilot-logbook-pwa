import { describe, expect, it } from "vitest"
import { flightSearchFields, matchesTerms, prepareTerm, squashFields } from "../logbook-search"
import type { FlightLog } from "@/types/entities/flight.types"

const flight = {
  id: "f1",
  date: "2026-11-07",
  flightNumber: "TR0288",
  aircraftReg: "9V-NCA",
  aircraftType: "A20N",
  departureIcao: "WSSS",
  arrivalIcao: "WICA",
  departureIata: "SIN",
  arrivalIata: "KNO",
  picName: "Tan Wei Ming",
  sicName: "Self",
  remarks: "Gusty crosswind",
  additionalCrew: [{ name: "Lee Ah Kow", role: "Relief Pilot" }],
} as unknown as FlightLog

const fields = flightSearchFields(flight)
const finds = (...terms: string[]) => matchesTerms(fields, terms.map(prepareTerm))

describe("logbook search", () => {
  it("ignores case, spacing and dashes in a registration", () => {
    expect(finds("9vnca")).toBe(true)
    expect(finds("9V NCA")).toBe(true)
    expect(finds("9v-nca")).toBe(true)
    expect(finds("NCA")).toBe(true)
  })

  it("matches a flight number however it is written", () => {
    expect(finds("TR288")).toBe(true)
    expect(finds("tr 288")).toBe(true)
    expect(finds("TR0288")).toBe(true)
    expect(finds("288")).toBe(true)
    expect(finds("289")).toBe(false)
  })

  it("matches a route as one term, in either code", () => {
    expect(finds("WSSS-WICA")).toBe(true)
    expect(finds("wsss wica")).toBe(true)
    expect(finds("SIN-KNO")).toBe(true)
    expect(finds("WICA-WSSS")).toBe(true) // both airports appear, in any order
    expect(finds("WSSS-VTBS")).toBe(false)
  })

  it("matches dates the way a pilot writes them", () => {
    expect(finds("7 Nov")).toBe(true)
    expect(finds("07 nov 26")).toBe(true)
    expect(finds("2026-11-07")).toBe(true)
    expect(finds("nov 2026")).toBe(true)
    expect(finds("8 Nov")).toBe(false)
  })

  it("finds crew by any part of a name, in any order", () => {
    expect(finds("wei ming")).toBe(true)
    expect(finds("ming tan")).toBe(true)
    expect(finds("ah kow")).toBe(true)
  })

  it("ANDs chips together", () => {
    expect(finds("288", "wsss")).toBe(true)
    expect(finds("288", "vtbs")).toBe(false)
  })

  it("searches remarks and the type", () => {
    expect(finds("crosswind")).toBe(true)
    expect(finds("a20n")).toBe(true)
  })

  it("ignores a term with nothing searchable in it", () => {
    expect(finds("-")).toBe(true)
  })

  it("squashes duty fields the same way", () => {
    const duty = squashFields(["SBY-1", "Home Standby", "standby", "2026-11-20"])
    expect(matchesTerms(duty, [prepareTerm("sby1")])).toBe(true)
    expect(matchesTerms(duty, [prepareTerm("home standby")])).toBe(true)
  })
})
