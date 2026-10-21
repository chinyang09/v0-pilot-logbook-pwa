/**
 * A flight that arrives without its PF/PM or role is filled from its own
 * figures — never a constant that files every such flight as flown, in command.
 */

import { describe, it, expect } from "vitest"
import { inferPilotFlying, inferPilotRole, UNSTATED_ROLE } from "../flight-evidence"
import { createEmptyFlightLog } from "../flight-calculations"
import { DEFAULT_LOGGING_PREFERENCES } from "@/types/db/stores.types"

describe("inferPilotFlying", () => {
  it("is flying when one of the pilot's takeoffs or landings is logged", () => {
    expect(inferPilotFlying({ nightLandings: 1 })).toBe(true)
    expect(inferPilotFlying({ dayTakeoffs: "1" })).toBe(true)
  })
  it("is not flying when none is", () => {
    expect(inferPilotFlying({})).toBe(false)
    expect(inferPilotFlying({ dayTakeoffs: 0, dayLandings: -1 })).toBe(false)
  })
})

describe("inferPilotRole", () => {
  it("reads the role time logged, the largest when several are", () => {
    expect(inferPilotRole({ picusTime: "2:10", sicTime: "0:30" })).toBe("PICUS")
    expect(inferPilotRole({ instructorTime: "01:00" })).toBe("Instructor")
  })
  it("logs a simulator Dual, and a pilot in the SIC seat SIC", () => {
    expect(inferPilotRole({ isSimulator: true })).toBe("Dual")
    expect(inferPilotRole({ entryType: "simulator" })).toBe("Dual")
    expect(inferPilotRole({ sicName: "Self" })).toBe("SIC")
  })
  it("falls to the one stated last resort only when the record says nothing", () => {
    expect(inferPilotRole({})).toBe(UNSTATED_ROLE)
  })
})

describe("createEmptyFlightLog", () => {
  it("starts PF/PM as Settings › Logging says", () => {
    expect(createEmptyFlightLog({ pilotFlying: false }).pilotFlying).toBe(false)
    expect(createEmptyFlightLog().pilotFlying).toBe(DEFAULT_LOGGING_PREFERENCES.newFlightPilotFlying)
  })
})
