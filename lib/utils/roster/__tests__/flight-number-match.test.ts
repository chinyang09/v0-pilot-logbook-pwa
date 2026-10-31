/**
 * When a report's flight number is the same flight as a logged one. It is the
 * reconciler's strongest tier, so a wrong "yes" pairs a sector with another
 * airline's flight and a wrong "no" turns an existing flight into a create.
 */

import { describe, it, expect } from "vitest"
import { sameFlightNumber } from "../reconciler"

describe("sameFlightNumber", () => {
  it("ignores leading zeros, spacing and case", () => {
    expect(sameFlightNumber("TR0288", "TR288")).toBe(true)
    expect(sameFlightNumber("tr 288", "TR288")).toBe(true)
    expect(sameFlightNumber("288", "TR0288")).toBe(true)
  })

  it("does not take another carrier's flight for this one", () => {
    expect(sameFlightNumber("TR288", "SQ288")).toBe(false)
  })

  it("lets an ICAO callsign or a bare number through — neither names a carrier", () => {
    expect(sameFlightNumber("TR288", "TGW288")).toBe(true)
    expect(sameFlightNumber("TR288", "288")).toBe(true)
  })

  it("never matches on nothing, or on different digits", () => {
    expect(sameFlightNumber("", "")).toBe(false)
    expect(sameFlightNumber("TR", "TR")).toBe(false)
    expect(sameFlightNumber("TR288", "TR289")).toBe(false)
  })
})
