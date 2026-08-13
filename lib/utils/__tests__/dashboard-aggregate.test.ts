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

    expect(result.totals.blockMinutes).toBe(360)
    expect(result.byEngine.jet).toBe(360)
  })

  it("types a tail from the reference database when the pilot never added it by hand", () => {
    // `userDb.aircraft` holds only aircraft the pilot created; the reference
    // database tags every registration the app has resolved. Without the second
    // lookup this flight counted toward the total and produced no type row,
    // so the breakdown came up short against the ring above it.
    const result = aggregateDashboard({
      flights: [flight({ aircraftReg: "9V-TNC" })],
      aircraft: [],
      referenceTypes: new Map([
        ["9VTNC", { typecode: "A20N", shortDescription: "L2J" }],
      ]),
      ...RANGE,
    })

    expect(result.topTypes).toEqual([{ type: "A20N", minutes: 120 }])
    expect(result.byEngine.jet).toBe(120)
  })

  it("prefers the pilot's own ICAO designator over the reference typecode", () => {
    const result = aggregateDashboard({
      flights: [flight({ aircraftReg: "9V-TNC" })],
      aircraft: [aircraft({ registration: "9V-TNC", typeDesignator: "A21N" })],
      referenceTypes: new Map([["9VTNC", { typecode: "A20N" }]]),
      ...RANGE,
    })

    expect(result.topTypes).toEqual([{ type: "A21N", minutes: 120 }])
  })

  it("prefers the reference typecode over a loose free-text type", () => {
    // `type` and `flight.aircraftType` are free text that can still hold a
    // carrier code; the reference table is an ICAO designator by construction.
    const result = aggregateDashboard({
      flights: [flight({ aircraftReg: "9V-TNC", aircraftType: "32N" })],
      aircraft: [aircraft({ registration: "9V-TNC", type: "320neo" })],
      referenceTypes: new Map([["9VTNC", { typecode: "A20N" }]]),
      ...RANGE,
    })

    expect(result.topTypes).toEqual([{ type: "A20N", minutes: 120 }])
  })
})

describe("aggregateDashboard — block time is the one clock", () => {
  // The hero ring, the day/night tiles and the per-flight list are all block
  // time (chocks-off to chocks-on), which is what an airline logbook records.
  // The aircraft breakdowns used to accumulate FLIGHT time (off→on, i.e. block
  // minus taxi), so the engine split read lower than the total directly above
  // it and the type rows could never sum to it.
  const taxiing = [
    flight({ id: "a", aircraftReg: "9V-TNA", blockTime: "02:00", flightTime: "01:40" }),
    flight({ id: "b", aircraftReg: "9V-TNA", blockTime: "03:00", flightTime: "02:30" }),
  ]
  const fleet = [aircraft({ registration: "9V-TNA", typeDesignator: "A20N", engineType: "JET" })]

  it("attributes type hours in block time, not flight time", () => {
    const result = aggregateDashboard({ flights: taxiing, aircraft: fleet, ...RANGE })

    expect(result.totals.blockMinutes).toBe(300)
    expect(result.totals.flightMinutes).toBe(250)
    expect(result.topTypes).toEqual([{ type: "A20N", minutes: 300 }])
  })

  it("attributes engine and category hours in block time", () => {
    const result = aggregateDashboard({ flights: taxiing, aircraft: fleet, ...RANGE })

    expect(result.byEngine.jet).toBe(300)
    expect(result.byCategory.airplane).toBe(300)
  })

  it("reconciles the type breakdown against the headline total", () => {
    // The whole complaint, stated as an invariant: with every tail resolved,
    // the type rows sum to exactly the number in the ring.
    const result = aggregateDashboard({
      flights: [
        flight({ id: "a", aircraftReg: "9V-TNA", blockTime: "02:00", flightTime: "01:40" }),
        flight({ id: "b", aircraftReg: "9V-TNB", blockTime: "03:00", flightTime: "02:30" }),
        flight({ id: "c", aircraftReg: "9V-TNC", blockTime: "01:30", flightTime: "01:10" }),
      ],
      aircraft: [
        aircraft({ registration: "9V-TNA", typeDesignator: "A21N" }),
        aircraft({ registration: "9V-TNB", type: "32N" }),
      ],
      referenceTypes: new Map([["9VTNC", { typecode: "A320" }]]),
      ...RANGE,
    })

    const summed = result.topTypes.reduce((n, t) => n + t.minutes, 0)
    expect(summed).toBe(result.totals.blockMinutes)
    expect(result.topTypes.map((t) => t.type).sort()).toEqual(["A20N", "A21N", "A320"])
  })
})
