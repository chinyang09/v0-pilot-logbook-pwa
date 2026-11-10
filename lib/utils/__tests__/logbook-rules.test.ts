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
  leadsTimeSection,
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
      helper: "Counts in P1 once the PIC certifies it",
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
  it("leads with the chosen authority's name", () => {
    expect(categoryLabel(timeCategory("instructorTime"), "FAA").label).toBe("Dual Given")
    expect(categoryLabel(timeCategory("picTime"), "CAAS").label).toBe("P1")
    expect(categoryLabel(timeCategory("sicTime"), "FAA").label).toBe("SIC")
  })

  it("says only the authority's own rule — no definitions, no other authorities' names", () => {
    expect(categoryLabel(timeCategory("picTime"), "CAAS").helper).toBe("")
    expect(categoryLabel(timeCategory("nightTime"), "FAA").helper).toBe("")
    expect(categoryLabel(timeCategory("soloTime"), "CAAS").helper).toBe("Also counts in P1")
  })

  it("never names EASA while its wording is unverified", () => {
    expect(OFFERED_AUTHORITIES.map((a) => a.value)).toEqual(["CAAS", "FAA"])
    for (const c of TIME_CATEGORIES) {
      for (const { value } of OFFERED_AUTHORITIES) expect(categoryLabel(c, value).helper).not.toMatch(/EASA/)
    }
  })
})

describe("leadsTimeSection — what the form's TIME section shows before asking", () => {
  const cat = (field: Parameters<typeof timeCategory>[0]) => timeCategory(field)

  it("leads with every category that holds time", () => {
    expect(leadsTimeSection(cat("ifrTime"), "01:51", "SIC")).toBe(true)
    expect(leadsTimeSection(cat("instructorTime"), "0:30", "SIC")).toBe(true)
  })

  it("leads with the seat's own role time even at zero", () => {
    expect(leadsTimeSection(cat(roleTimeField("SIC")), "00:00", "SIC")).toBe(true)
    expect(leadsTimeSection(cat(roleTimeField("PICUS")), undefined, "PICUS")).toBe(true)
  })

  it("leaves every other empty category behind More Categories", () => {
    expect(leadsTimeSection(cat(roleTimeField("PIC")), "00:00", "SIC")).toBe(false)
    expect(leadsTimeSection(cat("ifrTime"), "00:00", "SIC")).toBe(false)
    expect(leadsTimeSection(cat("ifrTime"), "0:00", undefined)).toBe(false)
  })
})
