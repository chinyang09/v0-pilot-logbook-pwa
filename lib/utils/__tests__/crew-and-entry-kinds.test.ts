/**
 * Crew complement, solo and positioning — the rules that decide whether a
 * logbook entry carries flight time at all, and of which kind.
 *
 * - A two-pilot TYPE makes every sector on it multi-pilot, and makes solo on
 *   it impossible (an A320 is never flown solo; a C172 often is).
 * - A positioning sector is DUTY but no flight time: no hours, no landings,
 *   not an operating sector for the FDP tables (Fifth Schedule para 8).
 */

import { describe, it, expect } from "vitest"
import { minimumPilots, requiresTwoPilots, withAdditionalCrew } from "../crew-complement"
import { isSoloFlight, soloConflict } from "../flight-evidence"
import { entryDuration, gateSpan, positioningPatch } from "../entry-type"
import { recalculateFlightFields } from "../flight-calculations"
import { aggregateDashboard } from "../dashboard-aggregate"
import { createDutyPeriodsFromFlights } from "../roster/fdp-calculator"
import { DEFAULT_AUTO_FILL_PREFERENCES } from "@/types/db/stores.types"
import type { FlightLog } from "@/types/entities/flight.types"

describe("minimumPilots", () => {
  it("knows the transport types are two-pilot", () => {
    for (const t of ["A320", "A21N", "A20N", "A359", "A388", "B738", "B38M", "B789", "B77W", "E190", "AT76", "DH8D", "CRJ9", "BCS3", "GLEX"]) {
      expect([t, minimumPilots(t)]).toEqual([t, 2])
    }
  })

  it("answers unknown, not single-pilot, for anything else — the crew decides then", () => {
    for (const t of ["C172", "PA28", "SR22", "PC12", "C25C", "E55P", "AT5T", "", undefined]) {
      expect(minimumPilots(t)).toBeNull()
    }
    expect(requiresTwoPilots(" a320 ")).toBe(true)
  })
})

describe("solo", () => {
  const ga = { pilotRole: "PIC" as const, aircraftType: "C172", picName: "Self" }

  it("is a PIC flight on a single-pilot type with nobody else recorded", () => {
    expect(isSoloFlight(ga)).toBe(true)
    expect(isSoloFlight({ ...ga, sicName: "Instructor Tan" })).toBe(false)
    expect(isSoloFlight({ ...ga, additionalCrew: [{ name: "Tan", role: "Observer" }] })).toBe(false)
    expect(isSoloFlight({ ...ga, pilotRole: "Dual" })).toBe(false)
    expect(isSoloFlight({ ...ga, aircraftType: "A320" })).toBe(false)
    expect(isSoloFlight({ ...ga, entryType: "simulator" })).toBe(false)
  })

  it("flags solo time on a two-pilot type, or with another pilot aboard", () => {
    expect(soloConflict({ ...ga, soloTime: "01:00" })).toBeNull()
    expect(soloConflict({ ...ga, soloTime: "00:00", aircraftType: "A320" })).toBeNull()
    expect(soloConflict({ ...ga, soloTime: "01:00", aircraftType: "A320" })).toMatch(/A320 is certified for two pilots/)
    expect(soloConflict({ ...ga, soloTime: "01:00", sicName: "Tan" })).toMatch(/Another pilot/)
  })

  const flight = (over: Partial<FlightLog>): Partial<FlightLog> => ({
    date: "2026-10-01",
    outTime: "02:00",
    inTime: "03:30",
    departureIcao: "WSSL",
    arrivalIcao: "WSSL",
    manualOverrides: {},
    ...ga,
    ...over,
  })
  const soloOn = { ...DEFAULT_AUTO_FILL_PREFERENCES, solo: true }

  it("is filled only when the pilot has turned the switch on, and never on an A320", () => {
    expect(recalculateFlightFields(flight({}), null, null).soloTime).toBeUndefined()
    expect(recalculateFlightFields(flight({}), null, null, soloOn).soloTime).toBe("01:30")
    expect(recalculateFlightFields(flight({ aircraftType: "A320" }), null, null, soloOn).soloTime).toBe("00:00")
    const pinned = flight({ aircraftType: "A320", soloTime: "01:30", manualOverrides: { soloTime: true } })
    expect(recalculateFlightFields(pinned, null, null, soloOn).soloTime).toBeUndefined()
  })
})

describe("positioning", () => {
  const sector: Partial<FlightLog> = {
    entryType: "positioning",
    isSimulator: false,
    outTime: "22:40",
    inTime: "01:10",
    blockTime: "02:30",
    flightTime: "02:20",
    nightTime: "02:30",
    picTime: "02:30",
    multiPilotTime: "02:30",
    dayLandings: 1,
    pilotFlying: true,
    manualOverrides: { picTime: true },
  }

  it("carries no flight time of any kind, whatever was pinned", () => {
    const patch = positioningPatch(sector)
    expect(patch).toMatchObject({
      blockTime: "00:00",
      flightTime: "00:00",
      nightTime: "00:00",
      picTime: "00:00",
      multiPilotTime: "00:00",
      dayLandings: 0,
      pilotFlying: false,
    })
    expect(recalculateFlightFields(sector, null, null)).toEqual(patch)
    expect(positioningPatch({ ...sector, ...patch })).toEqual({})
    expect(positioningPatch({ entryType: "flight", blockTime: "01:00" })).toEqual({})
  })

  it("shows its OUT→IN as its length, across midnight", () => {
    expect(gateSpan("22:40", "01:10")).toBe("2:30")
    expect(gateSpan("22:40", "")).toBe("")
    expect(entryDuration({ ...sector, blockTime: "00:00", simulatedInstrumentTime: "00:00" } as FlightLog)).toBe("2:30")
  })

  it("is duty but not an operating sector or flight time (para 8)", () => {
    const base = { date: "2026-10-05", departureTimezone: 8, arrivalTimezone: 8 }
    const flights = [
      { ...base, id: "pos", entryType: "positioning", departureIcao: "WSSS", arrivalIcao: "VHHH", scheduledOut: "01:00", outTime: "01:00", inTime: "04:50", blockTime: "00:00" },
      { ...base, id: "op", entryType: "flight", departureIcao: "VHHH", arrivalIcao: "WSSS", scheduledOut: "06:00", outTime: "06:00", inTime: "09:50", blockTime: "03:50" },
    ] as FlightLog[]
    const [duty] = createDutyPeriodsFromFlights(flights)
    expect(duty.sectorCount).toBe(1)
    expect(duty.sectorMinutes).toEqual([230])
    expect(duty.flightMinutes).toBe(230)
    // The duty window still opens an hour before the POSITIONING sector.
    expect(duty.reportTime).toBe("00:00")
  })

  it("is not one of the dashboard's flights", () => {
    const result = aggregateDashboard({
      flights: [
        { id: "a", date: "2026-10-05", outTime: "01:00", inTime: "03:00", blockTime: "02:00", flightTime: "02:00" },
        { id: "b", date: "2026-10-05", entryType: "positioning", outTime: "04:00", inTime: "06:00", blockTime: "00:00" },
      ] as FlightLog[],
      aircraft: [],
      fromIso: "2026-10-01",
      toIso: "2026-10-31",
    })
    expect(result.totals.flightCount).toBe(1)
    expect(result.periodFlights.map((f) => f.id)).toEqual(["a"])
  })
})

describe("withAdditionalCrew", () => {
  const flight = { picId: "cpt", sicId: "me", additionalCrew: [{ id: "rp", name: "Relief", role: "Relief Pilot" as const }] }

  it("adds a third pilot as a relief pilot", () => {
    expect(withAdditionalCrew(flight, { id: "obs", name: "Tan" })).toEqual([
      ...flight.additionalCrew,
      { id: "obs", name: "Tan", role: "Relief Pilot" },
    ])
  })

  it("never puts someone on the flight twice", () => {
    expect(withAdditionalCrew(flight, { id: "rp", name: "Relief" })).toBeNull()
    expect(withAdditionalCrew(flight, { id: "cpt", name: "Captain" })).toBeNull()
    expect(withAdditionalCrew(flight, { id: "me", name: "Self" })).toBeNull()
  })
})
