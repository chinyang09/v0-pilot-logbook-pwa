/**
 * A simulator's duration lives in `simulatedInstrumentTime` and nowhere else.
 * Every recalculation used to compute a block time from its OUT/IN, and a role
 * time from that block — the production data carried seven sessions at 4–6h of
 * block and two at 4h of SIC. These pin the repair and the guard that stops it
 * happening again.
 */

import { describe, it, expect } from "vitest"
import { simulatorRepairPatch, withoutSimulatorPins } from "../entry-type"
import { recalculateFlightFields } from "../flight-calculations"
import type { FlightLog } from "@/types/entities/flight.types"

const sim = (over: Partial<FlightLog> = {}): Partial<FlightLog> => ({
  isSimulator: true,
  entryType: "simulator",
  outTime: "10:55",
  inTime: "14:55",
  simulatedInstrumentTime: "04:00",
  blockTime: "00:00",
  flightTime: "00:00",
  dayTime: "00:00",
  nightTime: "00:00",
  picTime: "00:00",
  sicTime: "00:00",
  picusTime: "00:00",
  dualTime: "00:00",
  instructorTime: "00:00",
  crossCountryTime: "00:00",
  manualOverrides: { simulatedInstrumentTime: true, nightTime: true },
  ...over,
})

describe("simulatorRepairPatch", () => {
  it("leaves a correct simulator alone", () => {
    expect(simulatorRepairPatch(sim())).toEqual({})
  })

  it("zeroes the block, day and role times a recalculation gave it", () => {
    expect(simulatorRepairPatch(sim({ blockTime: "04:00", sicTime: "04:00", dayTime: "04:00" }))).toEqual({
      blockTime: "00:00",
      sicTime: "00:00",
      dayTime: "00:00",
    })
  })

  it("moves a duration that only reached block time to the session's own field", () => {
    expect(simulatorRepairPatch(sim({ blockTime: "06:00", simulatedInstrumentTime: "00:00" }))).toEqual({
      simulatedInstrumentTime: "06:00",
      blockTime: "00:00",
    })
  })

  it("keeps a role time the pilot pinned, but never a block time", () => {
    const patch = simulatorRepairPatch(
      sim({ blockTime: "04:00", sicTime: "04:00", manualOverrides: { sicTime: true } })
    )
    expect(patch).toEqual({ blockTime: "00:00" })
  })

  it("reads the legacy flag as well as entryType", () => {
    expect(simulatorRepairPatch(sim({ entryType: undefined, blockTime: "04:00" }))).toEqual({ blockTime: "00:00" })
  })

  it("never touches a flight", () => {
    expect(
      simulatorRepairPatch({ isSimulator: false, entryType: "flight", blockTime: "04:00", sicTime: "04:00" })
    ).toEqual({})
  })
})

describe("recalculateFlightFields on a simulator", () => {
  it("does not compute a block time from its OUT/IN", () => {
    const updates = recalculateFlightFields(sim(), null, null)
    expect(updates.blockTime).toBeUndefined()
    expect(updates).toEqual({})
  })

  it("repairs one that already carries a block time", () => {
    expect(recalculateFlightFields(sim({ blockTime: "06:00" }), null, null)).toEqual({ blockTime: "00:00" })
  })
})

describe("withoutSimulatorPins", () => {
  it("drops the session and zero-night pins when an entry becomes a flight", () => {
    expect(
      withoutSimulatorPins({ simulatedInstrumentTime: true, nightTime: true, sicTime: true }, "00:00")
    ).toEqual({ sicTime: true })
  })

  it("keeps a night pin that holds a real figure", () => {
    expect(withoutSimulatorPins({ simulatedInstrumentTime: true, nightTime: true }, "01:12")).toEqual({ nightTime: true })
  })
})
