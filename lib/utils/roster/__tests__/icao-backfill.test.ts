/**
 * A flight imported while its airports could not be resolved is stored with
 * IATA codes only — it reads "WSSS → CSX" in an ICAO display. The next report
 * that does resolve the airports FILLS the ICAO in (a safe field), and never
 * overwrites one the flight already has.
 */

import { describe, it, expect } from "vitest";
import { reconcileRoster, type ParsedSector } from "../reconciler";
import type { FlightLog } from "../../../../types/entities/flight.types";

const RANGE = { start: "2026-10-01", end: "2026-10-31" };

function flight(over: Partial<FlightLog>): FlightLog {
  return {
    id: "tr124",
    date: "2026-10-16",
    flightNumber: "TR124",
    aircraftReg: "",
    aircraftType: "A21N",
    departureIcao: "WSSS",
    departureIata: "SIN",
    arrivalIcao: "",
    arrivalIata: "CSX",
    departureTimezone: 8,
    arrivalTimezone: 0,
    scheduledOut: "10:10",
    scheduledIn: "15:05",
    outTime: "",
    offTime: "",
    onTime: "",
    inTime: "",
    blockTime: "00:00",
    flightTime: "00:00",
    nightTime: "00:00",
    dayTime: "00:00",
    picId: "",
    picName: "",
    sicId: "",
    sicName: "",
    additionalCrew: [],
    pilotFlying: true,
    pilotRole: "SIC",
    picTime: "00:00",
    sicTime: "00:00",
    picusTime: "00:00",
    dualTime: "00:00",
    instructorTime: "00:00",
    dayTakeoffs: 0,
    dayLandings: 0,
    nightTakeoffs: 0,
    nightLandings: 0,
    autolands: 0,
    remarks: "",
    endorsements: "",
    manualOverrides: {},
    ifrTime: "00:00",
    actualInstrumentTime: "00:00",
    simulatedInstrumentTime: "00:00",
    crossCountryTime: "00:00",
    approaches: [],
    holds: 0,
    ipcIcc: false,
    createdAt: 1,
    syncStatus: "synced",
    ...over,
  };
}

const SECTOR: ParsedSector = {
  date: "2026-10-16",
  flightNumber: "TR124",
  aircraftType: "A21N",
  departureIata: "SIN",
  arrivalIata: "CSX",
  departureIcao: "WSSS",
  arrivalIcao: "ZGHA",
  scheduledOut: "10:10",
  scheduledIn: "15:05",
  sourceLine: 1,
};

describe("ICAO backfill on re-import", () => {
  it("fills a blank ICAO as a safe update", () => {
    const [op] = reconcileRoster({
      sectors: [SECTOR],
      existingFlights: [flight({})],
      csvDateRange: RANGE,
      useLegacyUpdateConflict: false,
    });
    expect(op.kind).toBe("update_safe");
    if (op.kind !== "update_safe") return;
    expect(op.changes).toEqual([
      { field: "arrivalIcao", from: "", to: "ZGHA" },
    ]);
  });

  it("leaves an ICAO the flight already carries alone", () => {
    const [op] = reconcileRoster({
      sectors: [{ ...SECTOR, arrivalIcao: "ZGHA" }],
      existingFlights: [flight({ arrivalIcao: "ZGHH" })],
      csvDateRange: RANGE,
      useLegacyUpdateConflict: false,
    });
    expect(op.kind).toBe("skip_identical");
  });
});
