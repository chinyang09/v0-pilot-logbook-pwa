/**
 * The ICAO/IATA lookups are indexed, and the index has to be invisible.
 *
 * `getAirportByICAO`/`getAirportByIATA` were `airports.find(…)` scans over the
 * whole ~10k reference table, uppercasing every row for one hit. They are now
 * backed by a `WeakMap` index keyed on the array. That is only a safe swap if
 * it reproduces `find`'s exact behaviour, and two details are easy to get
 * wrong: `find` returns the FIRST match (so a duplicate code must not
 * overwrite the entry already indexed), and the IATA variant skipped rows with
 * no IATA code at all.
 *
 * The store reaches for IndexedDB at module scope, so `reference-db` is
 * stubbed — these functions are pure over the array they are handed.
 */

import { describe, it, expect, vi } from "vitest"

vi.mock("../../../reference-db", () => ({
  referenceDb: {
    airports: {},
    getMetadata: async () => undefined,
    setMetadata: async () => undefined,
  },
}))

import { getAirportByICAO, getAirportByIATA } from "../airports.store"
import type { Airport } from "@/types/entities/airport.types"

const airport = (icao: string, iata?: string, name = icao): Airport =>
  ({ icao, iata, name } as unknown as Airport)

describe("airport code lookups", () => {
  const airports = [
    airport("WSSS", "SIN", "Changi"),
    airport("WMKK", "KUL", "Kuala Lumpur"),
    airport("VTBS", "BKK", "Suvarnabhumi"),
    // No IATA — the old IATA scan skipped these outright.
    airport("WSAP", undefined, "Paya Lebar"),
  ]

  it("finds by ICAO, case-insensitively", () => {
    expect(getAirportByICAO(airports, "WMKK")?.name).toBe("Kuala Lumpur")
    expect(getAirportByICAO(airports, "wmkk")?.name).toBe("Kuala Lumpur")
    expect(getAirportByICAO(airports, "vtbs")?.name).toBe("Suvarnabhumi")
  })

  it("finds by IATA, case-insensitively, and ignores rows without one", () => {
    expect(getAirportByIATA(airports, "SIN")?.name).toBe("Changi")
    expect(getAirportByIATA(airports, "bkk")?.name).toBe("Suvarnabhumi")
    expect(getAirportByIATA(airports, "WSAP")).toBeUndefined()
  })

  it("returns undefined for an unknown code", () => {
    expect(getAirportByICAO(airports, "ZZZZ")).toBeUndefined()
    expect(getAirportByIATA(airports, "ZZZ")).toBeUndefined()
  })

  it("keeps the FIRST match when a code is duplicated, as `find` did", () => {
    const dupes = [
      airport("WSSS", "SIN", "first"),
      airport("WSSS", "SIN", "second"),
    ]
    expect(getAirportByICAO(dupes, "WSSS")?.name).toBe("first")
    expect(getAirportByIATA(dupes, "SIN")?.name).toBe("first")
  })

  it("does not serve one array's index to another", () => {
    const a = [airport("WSSS", "SIN", "changi")]
    const b = [airport("WSSS", "SIN", "somewhere else")]
    expect(getAirportByICAO(a, "WSSS")?.name).toBe("changi")
    expect(getAirportByICAO(b, "WSSS")?.name).toBe("somewhere else")
    // …and re-reading the first array still gives the first array's answer.
    expect(getAirportByICAO(a, "WSSS")?.name).toBe("changi")
  })

  it("is repeatable — a second lookup hits the cached index", () => {
    expect(getAirportByICAO(airports, "WSSS")?.name).toBe("Changi")
    expect(getAirportByICAO(airports, "WSSS")?.name).toBe("Changi")
    expect(getAirportByICAO(airports, "WMKK")?.name).toBe("Kuala Lumpur")
  })
})
