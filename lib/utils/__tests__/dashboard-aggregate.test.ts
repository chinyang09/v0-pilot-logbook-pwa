import { describe, expect, it } from "vitest"

import { aggregateDashboard } from "../dashboard-aggregate"
import type { FlightLog } from "@/types/entities/flight.types"
import type { Aircraft } from "@/types/entities/aircraft.types"

/**
 * The dashboard's aircraft-attributed numbers — the SE/ME/Jet split and the
 * "Top types" list — are joins from a flight onto an aircraft record. Both of
 * the keys in that join used to be raw strings, and both are written by several
 * producers that don't agree on spelling, so the join missed and the totals
 * didn't reconcile against the flight ring beside them.
 */

function flight(over: Partial<FlightLog>): FlightLog {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    date: "2026-08-10",
    outTime: "01:00",
    inTime: "03:00",
    blockTime: "02:00",
    flightTime: "02:00",
    ...over,
  } as FlightLog
}

function aircraft(over: Partial<Aircraft>): Aircraft {
  return {
    id: over.registration ?? "ac",
    registration: "",
    type: "",
    typeDesignator: "",
    model: "",
    category: "Airplane",
    engineType: "JET",
    isComplex: false,
    isHighPerformance: false,
    createdAt: 0,
    syncStatus: "synced",
    ...over,
  } as Aircraft
}

const RANGE = { fromIso: "2026-08-01", toIso: "2026-08-31" }

describe("aggregateDashboard — aircraft join", () => {
  it("merges a carrier type code into its ICAO designator instead of listing both", () => {
    // The same physical fleet, recorded two ways: one aircraft record kept the
    // eCrew carrier code for the A320neo ("32N"), the other the ICAO designator
    // ("A20N"). Unnormalized these were two rows, so the type breakdown named a
    // "32N" the pilot has never logged and its hours went missing from A20N.
    const result = aggregateDashboard({
      flights: [
        flight({ id: "a", aircraftReg: "9V-TNA" }),
        flight({ id: "b", aircraftReg: "9V-TNB" }),
      ],
      aircraft: [
        aircraft({ registration: "9V-TNA", type: "32N" }),
        aircraft({ registration: "9V-TNB", typeDesignator: "A20N" }),
      ],
      ...RANGE,
    })

    expect(result.topTypes).toEqual([{ type: "A20N", minutes: 240 }])
    expect(result.topTypes.map((t) => t.type)).not.toContain("32N")
  })

  it("leaves an unmapped type as its own row", () => {
    const result = aggregateDashboard({
      flights: [flight({ aircraftReg: "9V-SKU" })],
      aircraft: [aircraft({ registration: "9V-SKU", typeDesignator: "A388" })],
      ...RANGE,
    })

    expect(result.topTypes).toEqual([{ type: "A388", minutes: 120 }])
  })

  it("matches a dashless flight registration to a dashed aircraft record", () => {
    // A LogTen migration or an OCR read stores "9VNCE"; the aircraft record
    // says "9V-NCE". An exact-string join missed, and the flight then counted
    // toward the flight ring while contributing nothing to the engine split —
    // which is why Jet read lower than the total flight hours beside it.
    const result = aggregateDashboard({
      flights: [flight({ aircraftReg: "9VNCE" })],
      aircraft: [
        aircraft({ registration: "9V-NCE", typeDesignator: "A21N", engineType: "JET" }),
      ],
      ...RANGE,
    })

    expect(result.byEngine.jet).toBe(120)
    expect(result.byEngine.jet).toBe(result.totals.flightMinutes)
    expect(result.topTypes).toEqual([{ type: "A21N", minutes: 120 }])
  })

  it("attributes every flown minute to an engine class when the fleet resolves", () => {
    const result = aggregateDashboard({
      flights: [
        flight({ id: "a", aircraftReg: "9V-TNA" }),
        flight({ id: "b", aircraftReg: "9vtnb" }),
        flight({ id: "c", aircraftReg: "9V TNA" }),
      ],
      aircraft: [
        aircraft({ registration: "9V-TNA", engineType: "JET" }),
        aircraft({ registration: "9V-TNB", engineType: "JET" }),
      ],
      ...RANGE,
    })

    expect(result.totals.flightMinutes).toBe(360)
    expect(result.byEngine.jet).toBe(360)
  })
})
