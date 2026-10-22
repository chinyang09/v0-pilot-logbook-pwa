/**
 * The hour categories and what each authority calls them. The names are the
 * pilot's reading of their own logbook, so the rules pinned here are the ones a
 * wrong edit would quietly break: every stored time field has a category, the
 * helper always adds something, and changing the rules never hides a figure.
 */

import { describe, it, expect } from "vitest"
import {
  LOGBOOK_AUTHORITIES,
  OFFERED_AUTHORITIES,
  PILOT_ROLES,
  TIME_CATEGORIES,
  categoryLabel,
  roleLabel,
  roleTimeField,
  showsCategory,
  timeCategory,
} from "../logbook-rules"
import { createEmptyFlightLog, recalculateFlightFields } from "../flight-calculations"
import { inferMultiPilotTime, isMultiPilotFlight } from "../flight-evidence"
import { DEFAULT_AUTO_FILL_PREFERENCES } from "@/types/db/stores.types"
import type { FlightLog } from "@/types/entities/flight.types"

describe("the category table", () => {
  it("covers every role, once", () => {
    expect(PILOT_ROLES).toEqual(["PIC", "SIC", "PICUS", "Dual", "Instructor"])
    for (const role of PILOT_ROLES) expect(timeCategory(roleTimeField(role)).role).toBe(role)
  })

  it("names a stored field and an Auto-fill switch for every category", () => {
    const empty = createEmptyFlightLog()
    for (const c of TIME_CATEGORIES) {
      expect(empty[c.field]).toBe("00:00")
      expect(c.autoFill in DEFAULT_AUTO_FILL_PREFERENCES).toBe(true)
    }
    expect(new Set(TIME_CATEGORIES.map((c) => c.autoFill)).size).toBe(TIME_CATEGORIES.length)
    expect(Object.keys(DEFAULT_AUTO_FILL_PREFERENCES).sort()).toEqual(TIME_CATEGORIES.map((c) => c.autoFill).sort())
  })
})

describe("CAAS — SASP Part 1 Appendix B", () => {
  // Each expectation is the Appendix's own designation / column.
  const caas = (field: Parameters<typeof timeCategory>[0]) => categoryLabel(timeCategory(field), "CAAS")

  it("enters PIC time in the P1 column and co-pilot time as P2 (Cases A, C)", () => {
    expect(caas("picTime").label).toBe("P1")
    expect(roleLabel("PIC", "CAAS")).toBe("PIC")
    expect(caas("sicTime").label).toBe("P2")
    expect(roleLabel("SIC", "CAAS")).toBe("P2")
  })

  it("designates PIC U/S and says it counts in P1 once certified (Case B)", () => {
    expect(caas("picusTime")).toEqual({
      label: "PIC U/S",
      helper: "Counts in P1 once the PIC certifies it · FAA PIC (supervised)",
    })
    expect(roleLabel("PICUS", "CAAS")).toBe("PIC U/S")
  })

  it("designates a pilot under instruction P/UT, entered in the Dual column (Case G)", () => {
    expect(roleLabel("Dual", "CAAS")).toBe("P/UT")
    expect(caas("dualTime").label).toBe("Dual")
  })

  it("counts solo in P1 (Case L)", () => {
    expect(caas("soloTime").helper).toBe("Also counts in P1")
  })
})

describe("categoryLabel", () => {
  it("leads with the chosen authority's name and lists the offered others that differ", () => {
    expect(categoryLabel(timeCategory("instructorTime"), "FAA")).toEqual({ label: "Dual given", helper: "CAAS Instructor" })
    expect(categoryLabel(timeCategory("picTime"), "CAAS")).toEqual({ label: "P1", helper: "FAA PIC" })
    expect(categoryLabel(timeCategory("sicTime"), "FAA")).toEqual({ label: "SIC", helper: "CAAS P2" })
  })

  it("never names EASA while its wording is unverified", () => {
    expect(OFFERED_AUTHORITIES.map((a) => a.value)).toEqual(["CAAS", "FAA"])
    for (const c of TIME_CATEGORIES) {
      for (const { value } of OFFERED_AUTHORITIES) expect(categoryLabel(c, value).helper).not.toMatch(/EASA/)
    }
  })

  it("spells the category out when every authority agrees on the name", () => {
    expect(categoryLabel(timeCategory("nightTime"), "FAA").helper).toMatch(/twilight/)
  })

  it("never returns an empty helper", () => {
    for (const c of TIME_CATEGORIES) {
      for (const { value } of LOGBOOK_AUTHORITIES) expect(categoryLabel(c, value).helper.length).toBeGreaterThan(0)
    }
  })
})

describe("roleLabel", () => {
  it("names the role the way the rules do", () => {
    expect(roleLabel("Dual", "FAA")).toBe("Dual received")
    expect(roleLabel("Instructor", "FAA")).toBe("Dual given")
  })
})

describe("showsCategory", () => {
  it("offers what the authority's logbook keeps", () => {
    expect(showsCategory(timeCategory("picusTime"), "CAAS", "00:00")).toBe(true)
    expect(showsCategory(timeCategory("crossCountryTime"), "FAA", undefined)).toBe(true)
  })

  it("hides one it does not keep, unless the flight already holds time there", () => {
    expect(showsCategory(timeCategory("picusTime"), "FAA", "00:00")).toBe(false)
    expect(showsCategory(timeCategory("picusTime"), "FAA", "")).toBe(false)
    expect(showsCategory(timeCategory("picusTime"), "FAA", "01:20")).toBe(true)
  })
})

describe("multi-pilot time", () => {
  it("comes from the type, or the record's own crew: a co-pilot role, both seats named, a relief pilot", () => {
    expect(isMultiPilotFlight({ pilotRole: "PIC", aircraftType: "A21N" })).toBe(true)
    expect(isMultiPilotFlight({ pilotRole: "PIC", aircraftType: "C172" })).toBe(false)
    expect(isMultiPilotFlight({ pilotRole: "PIC", additionalCrew: [{ name: "Tan", role: "Relief Pilot" }] })).toBe(true)
    expect(isMultiPilotFlight({ pilotRole: "PIC", additionalCrew: [{ name: "Tan", role: "Observer" }] })).toBe(false)
    expect(isMultiPilotFlight({ pilotRole: "SIC", aircraftType: "A320", entryType: "positioning" })).toBe(false)
    expect(isMultiPilotFlight({ pilotRole: "SIC" })).toBe(true)
    expect(isMultiPilotFlight({ pilotRole: "PICUS" })).toBe(true)
    expect(isMultiPilotFlight({ pilotRole: "PIC", picName: "Self", sicName: "Tan" })).toBe(true)
    expect(isMultiPilotFlight({ pilotRole: "PIC", picName: "Self", sicName: " " })).toBe(false)
    expect(isMultiPilotFlight({ pilotRole: "SIC", entryType: "simulator" })).toBe(false)
  })

  const flight = (over: Partial<FlightLog>): Partial<FlightLog> => ({
    date: "2026-10-01",
    outTime: "02:00",
    inTime: "04:10",
    departureIcao: "WSSS",
    arrivalIcao: "VTBS",
    pilotRole: "SIC",
    manualOverrides: {},
    ...over,
  })

  it("is the block time on a multi-pilot flight, and zero on a single-pilot one", () => {
    expect(recalculateFlightFields(flight({}), null, null).multiPilotTime).toBe("02:10")
    expect(recalculateFlightFields(flight({ pilotRole: "PIC" }), null, null).multiPilotTime).toBe("00:00")
  })

  it("leaves a pinned figure and a switched-off category alone", () => {
    const pinned = flight({ multiPilotTime: "01:00", manualOverrides: { multiPilotTime: true } })
    expect(recalculateFlightFields(pinned, null, null).multiPilotTime).toBeUndefined()
    const off = { ...DEFAULT_AUTO_FILL_PREFERENCES, multiPilot: false }
    expect(recalculateFlightFields(flight({}), null, null, off).multiPilotTime).toBeUndefined()
  })

  it("fills a flight stored before the field existed, on the server and the client alike", () => {
    expect(inferMultiPilotTime({ pilotRole: "SIC", blockTime: "02:10" })).toBe("02:10")
    expect(inferMultiPilotTime({ pilotRole: "PIC", blockTime: "02:10" })).toBe("00:00")
    expect(inferMultiPilotTime({ pilotRole: "SIC" })).toBe("00:00")
    expect(inferMultiPilotTime({ pilotRole: "SIC", entryType: "simulator", blockTime: "04:00" })).toBe("00:00")
    // An airline sector imported with only the captain named is still two-crew.
    expect(inferMultiPilotTime({ pilotRole: "PIC", aircraftType: "A320", blockTime: "01:30" })).toBe("01:30")
  })
})
