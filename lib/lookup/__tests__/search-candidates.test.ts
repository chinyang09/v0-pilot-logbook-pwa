/**
 * The candidates a typed registration or airport code could mean, off the
 * Worker's grouped search answer — every hit that could be it, ranked, and
 * only an exact one marked so.
 */
import { describe, expect, it } from "vitest"
import { aircraftCandidates, airportCandidates } from "../search-candidates"

const aircraft = (reg: string, equip = "A320") => ({ id: reg, label: reg, detail: { owner: "Scoot", equip, hex: "76cf4c" }, type: "aircraft" })
const live = (reg: string, acType = "A21N") => ({ id: "3a1b", label: `TR6 / ${reg}`, detail: { reg, ac_type: acType }, type: "live" })
const airport = (label: string, lat = 1, lon = 2) => ({ id: "x", label, detail: { lat, lon }, type: "airport" })

describe("aircraftCandidates", () => {
  it("ranks exact, then the registrations the query begins, then those it is inside", () => {
    const grouped = { aircraft: [aircraft("9V-TOF"), aircraft("9V-OFJ"), aircraft("9V-OF")], live: [live("9V-OFA")] }
    const regs = aircraftCandidates(grouped, "9vof").map((c) => [c.registration, c.exact])
    expect(regs).toEqual([["9V-OF", true], ["9V-OFA", false], ["9V-OFJ", false]])
    // A tail remembered by its last letters is inside, after the prefixes.
    expect(aircraftCandidates(grouped, "OF").map((c) => c.registration)).toEqual(["9V-OF", "9V-OFA", "9V-OFJ", "9V-TOF"])
  })

  it("takes live flights' registrations, one row per tail, the airframe's fields first", () => {
    const grouped = { live: [live("9V-OFH", "B788")], aircraft: [aircraft("9V-OFH", "B789")] }
    expect(aircraftCandidates(grouped, "9VO")).toEqual([
      { registration: "9V-OFH", icao24: "76CF4C", typecode: "B789", operator: "Scoot", source: "fr24", exact: false },
    ])
  })

  it("drops hits whose registration does not contain the query — a flight number match", () => {
    expect(aircraftCandidates({ live: [live("9V-NCA")] }, "TR6")).toEqual([])
    expect(aircraftCandidates(null, "9VO")).toEqual([])
  })
})

describe("airportCandidates", () => {
  const grouped = {
    airport: [
      airport("Visakhapatnam Airport (VTZ / VOVZ)"),
      airport("Alluri Sitarama Raju International Airport (VTZ / VOVI)"),
      airport("Vijayawada Airport (VGA / VOBZ)"),
      airport("Some Strip ( / VOXX)"),
    ],
  }

  it("matches either code, exact first, codes read off the label", () => {
    const out = airportCandidates(grouped, "VOVI")
    expect(out[0]).toMatchObject({ icao: "VOVI", iata: "VTZ", name: "Alluri Sitarama Raju International Airport", exact: true })
    expect(airportCandidates(grouped, "vov").map((c) => c.icao)).toEqual(["VOVI", "VOVZ"])
    expect(airportCandidates(grouped, "VTZ").map((c) => [c.icao, c.exact])).toEqual([["VOVI", true], ["VOVZ", true]])
  })

  it("falls back to the name when the query is no code", () => {
    expect(airportCandidates(grouped, "alluri").map((c) => c.icao)).toEqual(["VOVI"])
  })
})
