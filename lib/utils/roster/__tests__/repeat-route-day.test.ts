/**
 * Repeated-route days must pair by TIME, not by list order.
 *
 * Real case (12 Jul 2026, from the Scoot Crew Logbook Report): four legs,
 * SIN→PEN→SIN→PEN→SIN, all on 9V-NCB. The report carries no flight-number
 * column, so route alone makes every SIN→PEN row a candidate for every
 * SIN→PEN flight. Matching by "first unclaimed flight on this route" paired
 * the 07:16 report row with the 12:25 flight and vice versa, and the import
 * then proposed swapping all four legs' times.
 *
 * Report rows (UTC):
 *   SIN 07:16 → PEN 08:39   1:23
 *   PEN 09:34 → SIN 11:21   1:47
 *   SIN 12:25 → PEN 13:42   1:17
 *   PEN 14:45 → SIN 16:16   1:31
 *
 * The stored flights hold exactly these times, so the correct answer is four
 * `skip_identical` and no proposed changes at all.
 */

import { describe, it, expect } from "vitest";
import { reconcileRoster, type ParsedSector } from "../reconciler";
import type { FlightLog } from "../../../../types/entities/flight.types";

const DATE = "2026-07-12";
const RANGE = { start: "2026-07-01", end: "2026-07-31" };

function makeFlight(
  id: string,
  flightNumber: string,
  dep: string,
  arr: string,
  out: string,
  inTime: string,
  block: string
): FlightLog {
  return {
    id,
    date: DATE,
    flightNumber,
    aircraftReg: "9V-NCB",
    aircraftType: "32Q",
    departureIcao: "",
    departureIata: dep,
    arrivalIcao: "",
    arrivalIata: arr,
    departureTimezone: 8,
    arrivalTimezone: 8,
    scheduledOut: out,
    scheduledIn: inTime,
    outTime: out,
    offTime: "",
    onTime: "",
    inTime,
    blockTime: block,
    flightTime: block,
    nightTime: "00:00",
    dayTime: "00:00",
    picId: "",
    picName: "Vishnu Ramalingam",
    sicId: "",
    sicName: "Self",
    additionalCrew: [],
    pilotFlying: true,
    pilotRole: "SIC",
    picTime: "00:00",
    sicTime: block,
    picusTime: "00:00",
    dualTime: "00:00",
    instructorTime: "00:00",
    dayTakeoffs: 1,
    dayLandings: 1,
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
  };
}

/** A crew-logbook row: no flight number, actual times only. */
function makeSector(
  dep: string,
  arr: string,
  out: string,
  inTime: string,
  block: string,
  sourceLine: number
): ParsedSector {
  return {
    date: DATE,
    flightNumber: "",
    aircraftType: "32Q",
    aircraftReg: "9V-NCB",
    departureIata: dep,
    arrivalIata: arr,
    actualOut: out,
    actualIn: inTime,
    blockTime: block,
    sourceLine,
  };
}

// Report order: ascending by time, as the PDF lists them.
const SECTORS: ParsedSector[] = [
  makeSector("SIN", "PEN", "07:16", "08:39", "01:23", 1),
  makeSector("PEN", "SIN", "09:34", "11:21", "01:47", 2),
  makeSector("SIN", "PEN", "12:25", "13:42", "01:17", 3),
  makeSector("PEN", "SIN", "14:45", "16:16", "01:31", 4),
];

// Stored order: descending by time, as the logbook list shows them.
const FLIGHTS: FlightLog[] = [
  makeFlight("tr499", "TR499", "PEN", "SIN", "14:45", "16:16", "01:31"),
  makeFlight("tr498", "TR498", "SIN", "PEN", "12:25", "13:42", "01:17"),
  makeFlight("tr425", "TR425", "PEN", "SIN", "09:34", "11:21", "01:47"),
  makeFlight("tr424", "TR424", "SIN", "PEN", "07:16", "08:39", "01:23"),
];

describe("repeated route on one day", () => {
  it("pairs each leg with the flight at the same time, not the first on the route", () => {
    const ops = reconcileRoster({
      sectors: SECTORS,
      existingFlights: FLIGHTS,
      csvDateRange: RANGE,
    });

    expect(ops).toHaveLength(4);
    for (const op of ops) {
      expect(op.kind).toBe("skip_identical");
    }
  });

  it("binds the right flight id to each report row", () => {
    const ops = reconcileRoster({
      sectors: SECTORS,
      existingFlights: FLIGHTS,
      csvDateRange: RANGE,
    });

    const boundIds = ops.map((op) => ("flight" in op ? op.flight.id : null));
    expect(boundIds).toEqual(["tr424", "tr425", "tr498", "tr499"]);
  });

  it("is order-independent — reversing either list gives the same pairing", () => {
    const ops = reconcileRoster({
      sectors: [...SECTORS].reverse(),
      existingFlights: [...FLIGHTS].reverse(),
      csvDateRange: RANGE,
    });

    const boundIds = ops.map((op) => ("flight" in op ? op.flight.id : null));
    expect(boundIds).toEqual(["tr499", "tr498", "tr425", "tr424"]);
    for (const op of ops) expect(op.kind).toBe("skip_identical");
  });

  it("still updates the leg that really did change, and only that one", () => {
    // The company revised the third leg's arrival by 6 minutes.
    const revised = [...SECTORS];
    revised[2] = makeSector("SIN", "PEN", "12:25", "13:48", "01:23", 3);

    const ops = reconcileRoster({
      sectors: revised,
      existingFlights: FLIGHTS,
      csvDateRange: RANGE,
    });

    const changed = ops.filter((op) => op.kind !== "skip_identical");
    expect(changed).toHaveLength(1);
    if (!("flight" in changed[0])) throw new Error("expected a matched op");
    expect(changed[0].flight.id).toBe("tr498");
  });

  it("pairs on scheduled times when the legs have not flown yet", () => {
    // A future roster day: stored flights carry scheduled times only, and the
    // report rows are planned (scheduled, no actuals).
    const scheduledFlights = FLIGHTS.map((f) => ({
      ...f,
      outTime: "",
      inTime: "",
    }));
    const plannedSectors = SECTORS.map((s) => ({
      ...s,
      actualOut: undefined,
      actualIn: undefined,
      scheduledOut: s.actualOut,
      scheduledIn: s.actualIn,
    }));

    const ops = reconcileRoster({
      sectors: plannedSectors,
      existingFlights: scheduledFlights,
      csvDateRange: RANGE,
    });

    const boundIds = ops.map((op) => ("flight" in op ? op.flight.id : null));
    expect(boundIds).toEqual(["tr424", "tr425", "tr498", "tr499"]);
  });
});
