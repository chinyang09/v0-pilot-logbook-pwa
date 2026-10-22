import { describe, expect, it } from "vitest"

import { createDutyPeriodsFromFlights } from "../fdp-calculator"
import type { FlightLog } from "@/types/entities/flight.types"

/** A duty's route is the airports it has — the dashboard prints it as "Last …". */
const f = (o: Partial<FlightLog>): FlightLog =>
  ({
    date: "2026-10-14",
    departureTimezone: 8,
    arrivalTimezone: 8,
    ...o,
  }) as FlightLog

describe("duty route", () => {
  it("chains the airports of a flight duty", () => {
    const [dp] = createDutyPeriodsFromFlights([
      f({ id: "a", departureIcao: "WSSS", arrivalIcao: "VTBS", outTime: "02:00", inTime: "04:30", blockTime: "02:30" }),
      f({ id: "b", departureIcao: "VTBS", arrivalIcao: "WSSS", outTime: "05:30", inTime: "08:00", blockTime: "02:30" }),
    ])
    expect(dp.route).toBe("WSSS-VTBS-WSSS")
  })

  it("names a simulator session SIM rather than ?-?", () => {
    const [dp] = createDutyPeriodsFromFlights([
      f({
        id: "sim",
        entryType: "simulator",
        isSimulator: true,
        departureIcao: "",
        arrivalIcao: "",
        outTime: "05:15",
        inTime: "11:15",
        simulatedInstrumentTime: "06:00",
      }),
    ])
    expect(dp?.route).toBe("SIM")
  })
})
