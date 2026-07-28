/**
 * Simulator sessions must survive being imported over and over.
 *
 * Every upload of the same Crew Logbook Report was adding another EBT row.
 * The old check keyed on `date|simSessionCode`, which only recognises a sim
 * written by a build that stored BOTH fields — so a sim logged by an earlier
 * build, or entered by hand, was invisible to the check and got duplicated on
 * every import.
 *
 * Recognition is structural now (no route, no registration), and matching
 * accepts either the session code or the session's start time.
 */

import { describe, it, expect } from "vitest";
import {
  isSameSimSession,
  looksLikeSimulator,
} from "../sim-sessions";
import type { FlightLog } from "../../../../types/entities/flight.types";

function simFlight(over: Partial<FlightLog> = {}): FlightLog {
  return {
    id: "s1",
    date: "2025-11-10",
    flightNumber: "",
    aircraftReg: "",
    aircraftType: "A318",
    departureIcao: "",
    departureIata: "",
    arrivalIcao: "",
    arrivalIata: "",
    departureTimezone: 0,
    arrivalTimezone: 0,
    scheduledOut: "",
    scheduledIn: "",
    outTime: "02:30",
    offTime: "",
    onTime: "",
    inTime: "06:30",
    blockTime: "00:00",
    flightTime: "00:00",
    nightTime: "00:00",
    dayTime: "00:00",
    picId: "",
    picName: "",
    sicId: "self",
    sicName: "Self",
    additionalCrew: [],
    pilotFlying: false,
    pilotRole: "Dual",
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
    simulatedInstrumentTime: "04:00",
    crossCountryTime: "00:00",
    approaches: [],
    holds: 0,
    ipcIcc: false,
    createdAt: 1,
    syncStatus: "synced",
    entryType: "simulator",
    isSimulator: true,
    simSessionCode: "EBT1",
    ...over,
  };
}

const INCOMING = { date: "2025-11-10", code: "EBT1", outUtc: "02:30" };

describe("looksLikeSimulator", () => {
  it("recognises a flagged sim", () => {
    expect(looksLikeSimulator(simFlight())).toBe(true);
  });

  it("recognises a legacy sim with no flag, by its shape", () => {
    const legacy = simFlight({
      entryType: undefined,
      isSimulator: undefined,
      simSessionCode: undefined,
    });
    expect(looksLikeSimulator(legacy)).toBe(true);
  });

  it("does not mistake a real flight for one", () => {
    const flight = simFlight({
      departureIata: "SIN",
      arrivalIata: "PEN",
      aircraftReg: "9V-NCB",
      entryType: "flight",
      isSimulator: false,
    });
    expect(looksLikeSimulator(flight)).toBe(false);
  });
});

describe("isSameSimSession", () => {
  it("matches on the session code", () => {
    expect(isSameSimSession(simFlight(), INCOMING)).toBe(true);
  });

  it("matches a legacy row with no code, on its start time", () => {
    const legacy = simFlight({
      simSessionCode: undefined,
      entryType: undefined,
      isSimulator: undefined,
    });
    expect(isSameSimSession(legacy, INCOMING)).toBe(true);
  });

  it("tolerates the UTC-vs-local-base day shift", () => {
    expect(
      isSameSimSession(simFlight({ date: "2025-11-11" }), INCOMING)
    ).toBe(true);
    expect(
      isSameSimSession(simFlight({ date: "2025-11-09" }), INCOMING)
    ).toBe(true);
  });

  it("keeps two genuinely different sessions apart", () => {
    // EBT1 and EBT2 on consecutive days: within the ±1 day tolerance, so the
    // code has to be what separates them.
    const ebt2 = simFlight({
      date: "2025-11-11",
      simSessionCode: "EBT2",
      outTime: "08:30",
    });
    expect(isSameSimSession(ebt2, INCOMING)).toBe(false);
  });

  it("does not match a session a week later", () => {
    expect(
      isSameSimSession(simFlight({ date: "2025-11-17" }), INCOMING)
    ).toBe(false);
  });

  it("matches when the code differs in case only", () => {
    expect(
      isSameSimSession(simFlight({ simSessionCode: "ebt1" }), INCOMING)
    ).toBe(true);
  });
});
