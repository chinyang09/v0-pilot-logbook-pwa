import { describe, expect, it } from "vitest"
import { airborneTimes, flightTimeRepairPatch, recalculateFlightFields } from "@/lib/utils/flight-calculations"
import type { Airport } from "@/types/entities/airport.types"
import type { FlightLog } from "@/types/entities/flight.types"

// OFF and ON are the times a pilot forgets; OUT/IN (which the company records)
// stand in for them — the owner's rule. Flight time and day/night takeoffs and
// landings both follow it.

const SIN = { icao: "WSSS", iata: "SIN", latitude: 1.3644, longitude: 103.9915, tz: "Asia/Singapore" } as Airport
const BKK = { icao: "VTBS", iata: "BKK", latitude: 13.69, longitude: 100.75, tz: "Asia/Bangkok" } as Airport

function flight(over: Partial<FlightLog>): Partial<FlightLog> {
  return {
    date: "2026-10-01",
    outTime: "14:00", // 22:00 in Singapore — dark
    offTime: "",
    onTime: "",
    inTime: "16:10",
    departureIcao: "WSSS",
    arrivalIcao: "VTBS",
    pilotRole: "SIC",
    pilotFlying: true,
    manualOverrides: {},
    ...over,
  }
}

describe("airborneTimes", () => {
  it("prefers OFF/ON, falls back to OUT/IN, and needs a valid pair", () => {
    expect(airborneTimes({ outTime: "10:00", offTime: "10:10", onTime: "12:00", inTime: "12:05" })).toEqual({
      off: "10:10",
      on: "12:00",
      fromGate: false,
    })
    expect(airborneTimes({ outTime: "10:00", offTime: "10:10", onTime: "", inTime: "12:05" })).toEqual({
      off: "10:00",
      on: "12:05",
      fromGate: true,
    })
    expect(airborneTimes({ outTime: "10:00", inTime: "" })).toBeNull()
    expect(airborneTimes({ outTime: "25:00", inTime: "26:00" })).toBeNull()
  })
})

describe("recalculateFlightFields without OFF/ON", () => {
  it("takes the flight time from OUT→IN", () => {
    expect(recalculateFlightFields(flight({}), SIN, BKK).flightTime).toBe("02:10")
  })

  it("decides day/night takeoffs and landings from OUT and IN", () => {
    const u = recalculateFlightFields(flight({}), SIN, BKK)
    expect([u.dayTakeoffs, u.nightTakeoffs, u.dayLandings, u.nightLandings]).toEqual([0, 1, 0, 1])
  })

  it("still uses OFF/ON when the flight has them", () => {
    const u = recalculateFlightFields(flight({ offTime: "14:15", onTime: "16:00" }), SIN, BKK)
    expect(u.flightTime).toBe("01:45")
  })
})

describe("flightTimeRepairPatch", () => {
  it("fills a 00:00 flight time on a row with no OFF/ON", () => {
    expect(flightTimeRepairPatch(flight({ flightTime: "00:00" }))).toEqual({ flightTime: "02:10" })
  })

  it("leaves a row with OFF/ON, a figure already there, or a simulator", () => {
    expect(flightTimeRepairPatch(flight({ offTime: "14:15", onTime: "16:00", flightTime: "00:00" }))).toEqual({})
    expect(flightTimeRepairPatch(flight({ flightTime: "01:50" }))).toEqual({})
    expect(flightTimeRepairPatch(flight({ flightTime: "00:00", entryType: "simulator", isSimulator: true }))).toEqual({})
  })
})
