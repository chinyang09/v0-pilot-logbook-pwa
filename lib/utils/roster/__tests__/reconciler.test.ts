/**
 * Tests for roster reconciler.
 */

import { describe, it, expect } from "vitest";
import {
  reconcileRoster,
  type ParsedSector,
} from "../reconciler";
import type { FlightLog } from "../../../../types/entities/flight.types";

// ============================================================
// Fixture helpers
// ============================================================

function makeFlight(overrides: Partial<FlightLog> = {}): FlightLog {
  const base: FlightLog = {
    id: crypto.randomUUID(),
    isDraft: false,
    date: "2026-04-02",
    flightNumber: "TR638",
    aircraftReg: "",
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
    dayTime: "00:00",
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
    updatedAt: 1_700_000_000_000,
    syncStatus: "synced",
  };
  return { ...base, ...overrides };
}

function makeSector(overrides: Partial<ParsedSector> = {}): ParsedSector {
  return {
    date: "2026-04-02",
    flightNumber: "TR638",
    aircraftType: "32N",
    departureIata: "SIN",
    arrivalIata: "BKK",
    scheduledOut: "03:50",
    scheduledIn: "07:22",
    actualOut: "04:49",
    actualIn: "07:22",
    sourceLine: 6,
    ...overrides,
  };
}

// ============================================================
// Creates
// ============================================================

describe("reconcileRoster — create", () => {
  it("classifies a sector with no DB match as 'create'", () => {
    const ops = reconcileRoster({
      sectors: [makeSector()],
      existingFlights: [],
      csvDateRange: { start: "2026-04-01", end: "2026-04-30" },
    });
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe("create");
  });

  it("creates with actual times when present, scheduled-only when not", () => {
    const schedOnly = makeSector({ actualOut: undefined, actualIn: undefined });
    const ops = reconcileRoster({
      sectors: [schedOnly],
      existingFlights: [],
      csvDateRange: { start: "2026-04-01", end: "2026-04-30" },
    });
    const op = ops[0];
    if (op.kind !== "create") throw new Error("expected create");
    expect(op.sector.scheduledOut).toBe("03:50");
    expect(op.sector.actualOut).toBeUndefined();
  });
});

// ============================================================
// Identical match
// ============================================================

describe("reconcileRoster — skip_identical", () => {
  it("skips when CSV and DB agree on all times", () => {
    const ops = reconcileRoster({
      sectors: [makeSector()],
      existingFlights: [makeFlight()],
      csvDateRange: { start: "2026-04-01", end: "2026-04-30" },
    });
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe("skip_identical");
  });
});

// ============================================================
// Time differences → conflict
// ============================================================

describe("reconcileRoster — update_conflict", () => {
  it("flags a conflict when scheduled times differ", () => {
    const dbFlight = makeFlight({ scheduledOut: "04:00" });
    const ops = reconcileRoster({
      sectors: [makeSector()],
      existingFlights: [dbFlight],
      csvDateRange: { start: "2026-04-01", end: "2026-04-30" },
    });
    expect(ops[0].kind).toBe("update_conflict");
    if (ops[0].kind !== "update_conflict") return;
    expect(ops[0].changes.map((c) => c.field)).toContain("scheduledOut");
  });

  it("flags conflict when actual times in CSV differ from DB", () => {
    const dbFlight = makeFlight({ outTime: "04:30" });
    const ops = reconcileRoster({
      sectors: [makeSector()],
      existingFlights: [dbFlight],
      csvDateRange: { start: "2026-04-01", end: "2026-04-30" },
    });
    expect(ops[0].kind).toBe("update_conflict");
  });

  it("does NOT flag conflict when CSV has no actuals and DB has actuals", () => {
    const csvSector = makeSector({
      actualOut: undefined,
      actualIn: undefined,
    });
    const ops = reconcileRoster({
      sectors: [csvSector],
      existingFlights: [makeFlight()],
      csvDateRange: { start: "2026-04-01", end: "2026-04-30" },
    });
    expect(ops[0].kind).toBe("skip_identical");
  });
});

// ============================================================
// User-edited flights → edited_conflict (separate bucket)
// ============================================================

describe("reconcileRoster — edited_conflict", () => {
  it("flags edited when flight has a signature", () => {
    const dbFlight = makeFlight({
      scheduledOut: "04:00",
      signature: {
        strokes: [],
        capturedAt: 1_700_000_100_000,
      } as any,
    });
    const ops = reconcileRoster({
      sectors: [makeSector()],
      existingFlights: [dbFlight],
      csvDateRange: { start: "2026-04-01", end: "2026-04-30" },
    });
    expect(ops[0].kind).toBe("edited_conflict");
  });

  it("flags edited when user changed remarks after initial sync", () => {
    const dbFlight = makeFlight({
      remarks: "Turbulence on descent",
      updatedAt: 1_700_000_500_000,
      lastSyncedAt: 1_700_000_000_000,
      scheduledOut: "04:00",
    });
    const ops = reconcileRoster({
      sectors: [makeSector()],
      existingFlights: [dbFlight],
      csvDateRange: { start: "2026-04-01", end: "2026-04-30" },
    });
    expect(ops[0].kind).toBe("edited_conflict");
  });

  it("treats freshly-imported flights as NOT edited", () => {
    const dbFlight = makeFlight({ scheduledOut: "04:00" });
    const ops = reconcileRoster({
      sectors: [makeSector()],
      existingFlights: [dbFlight],
      csvDateRange: { start: "2026-04-01", end: "2026-04-30" },
    });
    expect(ops[0].kind).toBe("update_conflict");
  });
});

// ============================================================
// Flight-number matching — TR638 vs bare "638"
// ============================================================

describe("reconcileRoster — flight-number normalization", () => {
  it("matches 'TR638' in CSV to '638' in DB", () => {
    const dbFlight = makeFlight({ flightNumber: "638" });
    const ops = reconcileRoster({
      sectors: [makeSector({ flightNumber: "TR638" })],
      existingFlights: [dbFlight],
      csvDateRange: { start: "2026-04-01", end: "2026-04-30" },
    });
    expect(ops[0].kind).toBe("skip_identical");
  });

  it("matches '638' in CSV to 'TR638' in DB", () => {
    const dbFlight = makeFlight({ flightNumber: "TR638" });
    const ops = reconcileRoster({
      sectors: [makeSector({ flightNumber: "638" })],
      existingFlights: [dbFlight],
      csvDateRange: { start: "2026-04-01", end: "2026-04-30" },
    });
    expect(ops[0].kind).toBe("skip_identical");
  });
});

// ============================================================
// Fallback route matching — when flight numbers differ
// ============================================================

describe("reconcileRoster — fallback route match", () => {
  it("matches same-date same-route flights when flight numbers differ", () => {
    const dbFlight = makeFlight({ flightNumber: "TR999" });
    const ops = reconcileRoster({
      sectors: [makeSector({ flightNumber: "TR638" })],
      existingFlights: [dbFlight],
      csvDateRange: { start: "2026-04-01", end: "2026-04-30" },
    });
    expect(ops[0].kind).toBe("update_conflict");
    if (ops[0].kind !== "update_conflict") return;
    expect(ops[0].changes.map((c) => c.field)).toContain("flightNumber");
  });
});

// ============================================================
// Missing from roster — deletion candidates
// ============================================================

describe("reconcileRoster — delete_missing", () => {
  it("flags TR-prefixed DB flights within CSV range that aren't in CSV", () => {
    const orphan = makeFlight({
      id: "orphan-1",
      flightNumber: "TR888",
      departureIata: "SIN",
      arrivalIata: "KUL",
      date: "2026-04-10",
    });
    const ops = reconcileRoster({
      sectors: [makeSector()],
      existingFlights: [makeFlight(), orphan],
      csvDateRange: { start: "2026-04-01", end: "2026-04-30" },
    });
    const deletes = ops.filter((o) => o.kind === "delete_missing");
    expect(deletes).toHaveLength(1);
    if (deletes[0].kind !== "delete_missing") return;
    expect(deletes[0].flight.id).toBe("orphan-1");
  });

  it("does NOT flag non-TR flights for deletion (manual / other carrier)", () => {
    const personalFlight = makeFlight({
      id: "personal-1",
      flightNumber: "N12345",
      date: "2026-04-10",
    });
    const ops = reconcileRoster({
      sectors: [makeSector()],
      existingFlights: [makeFlight(), personalFlight],
      csvDateRange: { start: "2026-04-01", end: "2026-04-30" },
    });
    expect(ops.filter((o) => o.kind === "delete_missing")).toHaveLength(0);
    expect(ops.filter((o) => o.kind === "skip_non_airline")).toHaveLength(1);
  });

  it("does NOT flag flights outside the CSV date range", () => {
    const priorFlight = makeFlight({
      id: "prior-1",
      flightNumber: "TR100",
      date: "2026-03-15",
    });
    const ops = reconcileRoster({
      sectors: [makeSector()],
      existingFlights: [makeFlight(), priorFlight],
      csvDateRange: { start: "2026-04-01", end: "2026-04-30" },
    });
    expect(ops.filter((o) => o.kind === "delete_missing")).toHaveLength(0);
  });

  it("does NOT flag drafts — drafts aren't yet committed", () => {
    const draft = makeFlight({
      id: "draft-1",
      flightNumber: "TR777",
      date: "2026-04-10",
      isDraft: true,
    });
    const ops = reconcileRoster({
      sectors: [makeSector()],
      existingFlights: [makeFlight(), draft],
      csvDateRange: { start: "2026-04-01", end: "2026-04-30" },
    });
    expect(ops.filter((o) => o.kind === "delete_missing")).toHaveLength(0);
  });
});

// ============================================================
// Summary
// ============================================================

describe("reconcileRoster — summary counts", () => {
  it("produces one operation per input sector plus one per deletion candidate", () => {
    const orphan = makeFlight({
      id: "orphan",
      flightNumber: "TR888",
      date: "2026-04-10",
    });
    const ops = reconcileRoster({
      sectors: [makeSector(), makeSector({ flightNumber: "TR639" })],
      existingFlights: [orphan],
      csvDateRange: { start: "2026-04-01", end: "2026-04-30" },
    });
    // 2 creates + 1 delete
    expect(ops).toHaveLength(3);
  });
});
