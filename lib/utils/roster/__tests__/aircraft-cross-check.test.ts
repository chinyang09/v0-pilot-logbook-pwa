/**
 * The import's aircraft cross-check: asked only where the published schedule
 * still names an aeroplane (a week back to a day ahead), nearest today first
 * and capped, and a difference is that day's SCHEDULED registration against
 * the record's — never a usual-times guess, never a schedule with no aeroplane.
 */

import { describe, expect, it } from "vitest"
import type { FlightLog } from "@/types/entities/flight.types"
import type { FlightSuggestion } from "@/lib/lookup/flight-suggest"
import {
  CROSS_CHECK_LIMIT,
  crossCheckCandidates,
  scheduledAircraftDiffers,
  withinScheduleWindow,
} from "../aircraft-cross-check"

const NOW = Date.parse("2026-10-30T04:00:00Z")
const suggestion = (over: Partial<FlightSuggestion>): FlightSuggestion => ({
  flightNumber: "TR288",
  date: "2026-10-30",
  basis: "scheduled",
  basedOn: null,
  origin: null,
  destination: null,
  scheduledDeparture: null,
  scheduledArrival: null,
  registration: "9V-TNF",
  typecode: "A20N",
  model: "",
  ...over,
})
const flight = (date: string, over: Partial<FlightLog> = {}) =>
  ({ id: date, date, flightNumber: "TR288", aircraftReg: "9V-TNA", ...over }) as FlightLog

describe("import aircraft cross-check", () => {
  it("asks only from a week back to a day ahead", () => {
    expect(withinScheduleWindow("2026-10-23", NOW)).toBe(true)
    expect(withinScheduleWindow("2026-10-22", NOW)).toBe(false)
    expect(withinScheduleWindow("2026-10-31", NOW)).toBe(true)
    expect(withinScheduleWindow("2026-11-01", NOW)).toBe(false)
    expect(withinScheduleWindow("bad", NOW)).toBe(false)
  })

  it("is a difference only against that day's scheduled aeroplane, spelling aside", () => {
    expect(scheduledAircraftDiffers({ aircraftReg: "9V-TNA" }, suggestion({}))).toBe("9V-TNF")
    expect(scheduledAircraftDiffers({ aircraftReg: "9vtnf" }, suggestion({}))).toBeNull()
    expect(scheduledAircraftDiffers({ aircraftReg: "9V-TNA" }, suggestion({ registration: "" }))).toBeNull()
    expect(scheduledAircraftDiffers({ aircraftReg: "9V-TNA" }, suggestion({ basis: "usual" }))).toBeNull()
    expect(scheduledAircraftDiffers({ aircraftReg: "" }, suggestion({}))).toBeNull()
  })

  it("checks flights with a number and an aeroplane in the window, nearest today first, capped", () => {
    const picked = crossCheckCandidates(
      [flight("2026-10-25"), flight("2026-10-30"), flight("2026-09-01"), flight("2026-10-29", { aircraftReg: "" }), flight("2026-10-28", { flightNumber: "" })],
      NOW
    )
    expect(picked.map((f) => f.date)).toEqual(["2026-10-30", "2026-10-25"])
    const many = Array.from({ length: 40 }, () => flight("2026-10-29"))
    expect(crossCheckCandidates(many, NOW)).toHaveLength(CROSS_CHECK_LIMIT)
  })
})
