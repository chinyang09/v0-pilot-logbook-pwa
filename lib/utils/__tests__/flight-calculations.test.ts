import { describe, expect, it } from "vitest"
import { hasCoordinates, recalculateFlightFields } from "@/lib/utils/flight-calculations"
import { calculateNightTimeComplete } from "@/lib/utils/night-time"
import type { Airport } from "@/types/entities/airport.types"
import type { FlightLog } from "@/types/entities/flight.types"

const SIN = { icao: "WSSS", iata: "SIN", latitude: 1.3644, longitude: 103.9915, tz: "Asia/Singapore" } as Airport
const BKK = { icao: "VTBS", iata: "BKK", latitude: 13.69, longitude: 100.75, tz: "Asia/Bangkok" } as Airport
const BLANK = { icao: "ZZZZ", iata: "", latitude: 0, longitude: 0 } as Airport

function flight(over: Partial<FlightLog>): Partial<FlightLog> {
  return {
    date: "2026-10-01",
    outTime: "12:00",
    offTime: "12:10",
    onTime: "14:00",
    inTime: "14:10",
    departureIcao: "WSSS",
    arrivalIcao: "VTBS",
    pilotRole: "SIC",
    manualOverrides: {},
    ...over,
  }
}

describe("recalculateFlightFields — what a pilot pinned stays pinned", () => {
  it("does not recompute any role time once Dual or Instructor is pinned", () => {
    const updates = recalculateFlightFields(
      flight({ dualTime: "01:00", manualOverrides: { dualTime: true } }),
      SIN,
      BKK
    )
    expect(updates.dualTime).toBeUndefined()
    expect(updates.sicTime).toBeUndefined()
    expect(updates.instructorTime).toBeUndefined()
  })

  it("leaves night time alone when an airport has no real position", () => {
    // A custom airport saved blank is 0°N 0°E — the sun there says nothing
    // about a Singapore departure, and 00:00 over a stored value is a loss.
    const updates = recalculateFlightFields(flight({ nightTime: "02:00" }), SIN, BLANK)
    expect(updates.nightTime).toBeUndefined()
    expect(updates.dayTime).toBe("00:10") // 2:10 block − the night it already has
  })
})

describe("hasCoordinates", () => {
  it("rejects 0/0, NaN and a missing longitude", () => {
    expect(hasCoordinates(SIN)).toBe(true)
    expect(hasCoordinates(BLANK)).toBe(false)
    expect(hasCoordinates({ latitude: 1.3, longitude: NaN })).toBe(false)
    expect(hasCoordinates({ latitude: 1.3 } as Airport)).toBe(false)
    expect(hasCoordinates(null)).toBe(false)
  })
})

describe("calculateNightTimeComplete — out-of-order times", () => {
  it("never reports more night than block when OFF was typed before OUT", () => {
    const sin = { lat: SIN.latitude!, lon: SIN.longitude! }
    const r = calculateNightTimeComplete("2026-10-01", "10:00", "09:55", "11:00", "11:10", sin, sin)
    expect(r.totalBlockMinutes).toBe(70)
    expect(r.totalNightMinutes).toBeLessThanOrEqual(70)
  })

  it("refuses a missing longitude rather than computing a night of zero", () => {
    const r = calculateNightTimeComplete(
      "2026-10-01", "12:00", "", "", "14:00",
      { lat: 1.36, lon: NaN },
      { lat: 13.69, lon: 100.75 }
    )
    expect(r.totalBlockMinutes).toBe(0)
  })
})
