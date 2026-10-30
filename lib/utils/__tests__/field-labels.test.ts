import { describe, expect, it } from "vitest"
import { flightFieldLabel } from "@/lib/utils/field-labels"

describe("flightFieldLabel", () => {
  it("names the fields a comparison or an import note carries", () => {
    expect(flightFieldLabel("outTime")).toBe("OUT")
    expect(flightFieldLabel("departureIcao")).toBe("Departure (ICAO)")
    expect(flightFieldLabel("pilotFlying")).toBe("Pilot Flying")
  })

  it("spells out a key it does not know rather than showing it raw", () => {
    expect(flightFieldLabel("simSessionCode")).toBe("Sim Session Code")
    expect(flightFieldLabel("")).toBe("")
  })
})
