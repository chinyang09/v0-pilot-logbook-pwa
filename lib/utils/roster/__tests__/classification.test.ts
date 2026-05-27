/**
 * Tests for the safe-vs-critical change classifier.
 */

import { describe, it, expect } from "vitest";
import { classifyChanges, isSafeChange } from "../classification";
import type { FlightLog } from "../../../../types/entities/flight.types";
import type { FieldDiff } from "../reconciler";

function makeFlight(overrides: Partial<FlightLog> = {}): FlightLog {
  return {
    id: "f-1",
    date: "2026-04-02",
    flightNumber: "TR638",
    aircraftReg: "9V-TNJ",
    aircraftType: "32N",
    departureIcao: "WSSS",
    departureIata: "SIN",
    arrivalIcao: "VTBS",
    arrivalIata: "BKK",
    departureTimezone: 8,
    arrivalTimezone: 7,
    scheduledOut: "03:50",
    scheduledIn: "07:22",
    outTime: "04:49",
    offTime: "",
    onTime: "",
    inTime: "07:22",
    blockTime: "02:33",
    flightTime: "00:00",
    nightTime: "00:00",
    dayTime: "02:33",
    picId: "",
    picName: "",
    sicId: "",
    sicName: "",
    additionalCrew: [],
    pilotFlying: true,
    pilotRole: "SIC",
    picTime: "00:00",
    sicTime: "02:33",
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
    createdAt: 1_700_000_000_000,
    syncStatus: "synced",
    ...overrides,
  };
}

describe("isSafeChange", () => {
  const flight = makeFlight();

  it("treats picName changes as safe", () => {
    expect(
      isSafeChange(
        { field: "picName", from: "Old Name", to: "New Name" },
        flight
      )
    ).toBe(true);
  });

  it("treats outTime changes as critical", () => {
    expect(
      isSafeChange(
        { field: "outTime", from: "04:00", to: "04:49" },
        flight
      )
    ).toBe(false);
  });

  it("treats critical-field empty→value as safe (enrichment)", () => {
    expect(
      isSafeChange(
        { field: "aircraftReg", from: "", to: "9V-TNJ" },
        flight
      )
    ).toBe(true);
  });

  it("treats truncated→full PIC name as safe", () => {
    expect(
      isSafeChange(
        {
          field: "picName",
          from: "Muhammad Farhan Bin ", // 20 chars truncated
          to: "Muhammad Farhan Bin Abdul Latiff",
        },
        flight
      )
    ).toBe(true);
  });
});

describe("classifyChanges", () => {
  const flight = makeFlight();
  const today = "2026-05-09";

  it("future flight → update_safe regardless of fields", () => {
    const future = makeFlight({ date: "2026-06-01" });
    const changes: FieldDiff[] = [
      { field: "outTime", from: "04:00", to: "04:49" },
    ];
    expect(classifyChanges(future, changes, [], today)).toBe("update_safe");
  });

  it("past flight + only safe fields → update_safe", () => {
    const changes: FieldDiff[] = [
      { field: "picName", from: "Old", to: "New" },
    ];
    expect(classifyChanges(flight, changes, [], today)).toBe("update_safe");
  });

  it("past flight + critical field → update_consult", () => {
    const changes: FieldDiff[] = [
      { field: "outTime", from: "04:00", to: "04:49" },
    ];
    expect(classifyChanges(flight, changes, [], today)).toBe("update_consult");
  });

  it("past flight + edits → edited_conflict regardless of fields", () => {
    const changes: FieldDiff[] = [
      { field: "picName", from: "Old", to: "New" },
    ];
    expect(
      classifyChanges(flight, changes, ["has_signature"], today)
    ).toBe("edited_conflict");
  });

  it("past flight + manual-override edit reason → edited_conflict", () => {
    const changes: FieldDiff[] = [
      { field: "outTime", from: "04:00", to: "04:49" },
    ];
    expect(
      classifyChanges(flight, changes, ["has_manual_overrides"], today)
    ).toBe("edited_conflict");
  });
});
