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

// ============================================================
// TO/LDG decision memory — once decided, don't re-flag
// ============================================================

describe("reconcileRoster — TO/LDG decision marker", () => {
  it("does NOT diff TO/LDG when the existing flight remarks carry the decision marker", () => {
    const flight = makeFlight({
      remarks: "Some pilot note\n[TO/LDG decision recorded] 2026-04-15",
      dayTakeoffs: 1,
      nightTakeoffs: 0,
      dayLandings: 1,
      nightLandings: 0,
    });
    const ops = reconcileRoster({
      sectors: [
        makeSector({
          dayTakeoffs: 0,
          nightTakeoffs: 1,
          dayLandings: 0,
          nightLandings: 1,
        } as unknown as Parameters<typeof makeSector>[0]),
      ],
      existingFlights: [flight],
      csvDateRange: { start: "2026-04-01", end: "2026-04-30" },
    });
    if (
      ops[0].kind === "update_conflict" ||
      ops[0].kind === "update_safe" ||
      ops[0].kind === "update_consult" ||
      ops[0].kind === "edited_conflict"
    ) {
      const toLdgFields = ops[0].changes
        .map((c) => c.field)
        .filter((f) =>
          ["dayTakeoffs", "nightTakeoffs", "dayLandings", "nightLandings"].includes(f)
        );
      expect(toLdgFields).toHaveLength(0);
    }
  });

  it("applies OUR calculated day/night value and flags the company's figure", () => {
    const flight = makeFlight({
      dayTakeoffs: 0,
      nightTakeoffs: 0,
      dayLandings: 0,
      nightLandings: 0,
    });
    const ops = reconcileRoster({
      sectors: [
        makeSector({
          // Company recorded a DAY takeoff; our sun calc says NIGHT.
          dayTakeoffs: 1,
          nightTakeoffs: 0,
          dayLandings: 1,
          nightLandings: 0,
          suggestedDayTakeoffs: 0,
          suggestedNightTakeoffs: 1,
        } as unknown as Parameters<typeof makeSector>[0]),
      ],
      existingFlights: [flight],
      csvDateRange: { start: "2026-04-01", end: "2026-04-30" },
    });
    if (ops[0].kind !== "update_conflict") {
      throw new Error(`expected update_conflict got ${ops[0].kind}`);
    }
    // We trust our calculator: the night takeoff is applied...
    const nightTo = ops[0].changes.find((c) => c.field === "nightTakeoffs");
    expect(nightTo?.to).toBe("1");
    // ...and the company's disagreeing figure is surfaced for the UI badge.
    expect(nightTo?.companyValue).toBe("0");

    // Our calc agrees with the existing 0 day-takeoffs, so nothing to change
    // there — the company's erroneous "1" is simply not applied.
    expect(
      ops[0].changes.find((c) => c.field === "dayTakeoffs")
    ).toBeUndefined();
  });

  it("does NOT flag a company value when our calc agrees with it", () => {
    const flight = makeFlight({ dayLandings: 0, nightLandings: 0 });
    const ops = reconcileRoster({
      sectors: [
        makeSector({
          dayLandings: 0,
          nightLandings: 1,
          suggestedDayLandings: 0,
          suggestedNightLandings: 1,
        } as unknown as Parameters<typeof makeSector>[0]),
      ],
      existingFlights: [flight],
      csvDateRange: { start: "2026-04-01", end: "2026-04-30" },
    });
    if (ops[0].kind !== "update_conflict") {
      throw new Error(`expected update_conflict got ${ops[0].kind}`);
    }
    const nightLdg = ops[0].changes.find((c) => c.field === "nightLandings");
    expect(nightLdg?.to).toBe("1");
    expect(nightLdg?.companyValue).toBeUndefined();
  });
});

// ============================================================
// PIC truncation handshake — logbook 20-char limit vs schedule full names
// ============================================================

describe("reconcileRoster — picName truncation handshake", () => {
  it("does NOT diff when sector resolved to a truncated form of the existing full name", () => {
    const flight = makeFlight({
      picName: "Siah Yang Tek, Timothy",
      picId: "personnel-A",
    });
    const ops = reconcileRoster({
      sectors: [
        makeSector({
          // Sector resolved to truncated form (resolver couldn't find the
          // existing personnel for some reason — e.g., legacy data).
          picRawName: "Siah Yang Tek, Timot",
          picResolvedName: "Siah Yang Tek, Timot",
          picPersonnelId: "personnel-NEW",
        } as unknown as Parameters<typeof makeSector>[0]),
      ],
      existingFlights: [flight],
      csvDateRange: { start: "2026-04-01", end: "2026-04-30" },
    });
    // Should be skip_identical (no name/id diff and no other changes).
    expect(ops[0].kind).toBe("skip_identical");
  });

  it("DOES diff when sector resolved to the longer/canonical form", () => {
    const flight = makeFlight({
      picName: "Siah Yang Tek, Timot",
      picId: "personnel-OLD",
    });
    const ops = reconcileRoster({
      sectors: [
        makeSector({
          picResolvedName: "Siah Yang Tek, Timothy",
          picPersonnelId: "personnel-A",
        } as unknown as Parameters<typeof makeSector>[0]),
      ],
      existingFlights: [flight],
      csvDateRange: { start: "2026-04-01", end: "2026-04-30" },
    });
    if (ops[0].kind !== "update_conflict") {
      throw new Error(`expected update_conflict got ${ops[0].kind}`);
    }
    expect(ops[0].changes.map((c) => c.field)).toContain("picName");
  });
});

// ============================================================
// Full-crew reconciliation on updates (schedule carries CPT + FO)
// ============================================================

describe("reconcileRoster — crew update from schedule", () => {
  const currentUser = { id: "me", crewId: "9766" };

  it("adds the SIC (FO) to an existing flight that had no SIC", () => {
    const flight = makeFlight({
      picName: "Self",
      picId: "me",
      sicName: "",
      sicId: "",
    });
    const ops = reconcileRoster({
      sectors: [
        makeSector({
          crew: [
            { role: "CPT", crewId: "2841", name: "Tham Meiting, Joann", personnelId: "p-cpt" },
            // User (crewId 9766) is the FO on this sector → SIC = Self.
            { role: "FO", crewId: "9766", name: "Lim Chin Yang", personnelId: "me" },
          ],
        } as unknown as Parameters<typeof makeSector>[0]),
      ],
      existingFlights: [flight],
      csvDateRange: { start: "2026-04-01", end: "2026-04-30" },
      currentUser,
    });
    if (
      ops[0].kind !== "update_conflict" &&
      ops[0].kind !== "update_safe" &&
      ops[0].kind !== "update_consult"
    ) {
      throw new Error(`expected an update op, got ${ops[0].kind}`);
    }
    const fields = ops[0].changes.map((c) => c.field);
    expect(fields).toContain("picName");
    expect(fields).toContain("sicName");
    const sicName = ops[0].changes.find((c) => c.field === "sicName");
    expect(sicName?.to).toBe("Self");
    const picName = ops[0].changes.find((c) => c.field === "picName");
    expect(picName?.to).toBe("Tham Meiting, Joann");
  });

  it("upgrades a truncated PIC name to the schedule's full form", () => {
    const flight = makeFlight({
      picName: "Siah Yang Tek, Timot",
      picId: "p-old",
    });
    const ops = reconcileRoster({
      sectors: [
        makeSector({
          crew: [
            {
              role: "CPT",
              crewId: "6409",
              name: "Siah Yang Tek, Timothy",
              personnelId: "p-new",
            },
            { role: "FO", crewId: "9766", name: "Lim Chin Yang", personnelId: "me" },
          ],
        } as unknown as Parameters<typeof makeSector>[0]),
      ],
      existingFlights: [flight],
      csvDateRange: { start: "2026-04-01", end: "2026-04-30" },
      currentUser,
    });
    if (
      ops[0].kind !== "update_conflict" &&
      ops[0].kind !== "update_safe" &&
      ops[0].kind !== "update_consult"
    ) {
      throw new Error(`expected an update op, got ${ops[0].kind}`);
    }
    const picName = ops[0].changes.find((c) => c.field === "picName");
    expect(picName?.to).toBe("Siah Yang Tek, Timothy");
    // id follows the name upgrade
    const picId = ops[0].changes.find((c) => c.field === "picId");
    expect(picId?.to).toBe("p-new");
  });

  it("does NOT downgrade a full PIC name to a truncated re-import", () => {
    const flight = makeFlight({
      picName: "Siah Yang Tek, Timothy",
      picId: "p-full",
      sicName: "Self",
      sicId: "me",
    });
    const ops = reconcileRoster({
      sectors: [
        makeSector({
          crew: [
            { role: "CPT", crewId: "6409", name: "Siah Yang Tek, Timot", personnelId: "p-trunc" },
            { role: "FO", crewId: "9766", name: "Lim Chin Yang", personnelId: "me" },
          ],
        } as unknown as Parameters<typeof makeSector>[0]),
      ],
      existingFlights: [flight],
      csvDateRange: { start: "2026-04-01", end: "2026-04-30" },
      currentUser,
    });
    // Same person (truncated), SIC already Self → nothing to change.
    expect(ops[0].kind).toBe("skip_identical");
  });

  it("marks the user as PIC (Self) when they are the captain", () => {
    const flight = makeFlight({ picName: "", picId: "", sicName: "", sicId: "" });
    const ops = reconcileRoster({
      sectors: [
        makeSector({
          crew: [
            { role: "CPT", crewId: "9766", name: "Lim Chin Yang", personnelId: "me" },
            { role: "FO", crewId: "3000", name: "Other Pilot", personnelId: "p-fo" },
          ],
        } as unknown as Parameters<typeof makeSector>[0]),
      ],
      existingFlights: [flight],
      csvDateRange: { start: "2026-04-01", end: "2026-04-30" },
      currentUser,
    });
    if (
      ops[0].kind !== "update_conflict" &&
      ops[0].kind !== "update_safe" &&
      ops[0].kind !== "update_consult"
    ) {
      throw new Error(`expected an update op, got ${ops[0].kind}`);
    }
    const picName = ops[0].changes.find((c) => c.field === "picName");
    expect(picName?.to).toBe("Self");
    const sicName = ops[0].changes.find((c) => c.field === "sicName");
    expect(sicName?.to).toBe("Other Pilot");
  });
});

// ============================================================
// Sun-position day/night context on TO/LDG diffs
// ============================================================

describe("reconcileRoster — TO/LDG sun-position note", () => {
  it("attaches OUT/IN times + sunrise/sunset cutoff to a TO/LDG diff", () => {
    const flight = makeFlight({
      arrivalIata: "CJB",
      dayLandings: 1,
      nightLandings: 0,
    });
    const ops = reconcileRoster({
      sectors: [
        makeSector({
          arrivalIata: "CJB",
          // Logbook says night landing; existing flight has day landing.
          dayLandings: 0,
          nightLandings: 1,
          suggestedDayLandings: 0,
          suggestedNightLandings: 1,
          toLdgContext: {
            outUtc: "12:53",
            inUtc: "17:13",
            depLocal: "20:53",
            depTzOffset: 8,
            depSunStatus: "night",
            depSunriseUtc: "22:55",
            depSunsetUtc: "11:00",
            arrLocal: "22:43",
            arrTzOffset: 5.5,
            arrSunStatus: "night",
            arrSunriseUtc: "00:35",
            arrSunsetUtc: "12:50",
          },
        } as unknown as Parameters<typeof makeSector>[0]),
      ],
      existingFlights: [flight],
      csvDateRange: { start: "2026-04-01", end: "2026-04-30" },
    });
    if (
      ops[0].kind !== "update_conflict" &&
      ops[0].kind !== "update_consult"
    ) {
      throw new Error(`expected an update op, got ${ops[0].kind}`);
    }
    // The day-landing is cleared and the night-landing applied, per our calc.
    const dayLdg = ops[0].changes.find((c) => c.field === "dayLandings");
    expect(dayLdg?.to).toBe("0");
    const nightLdg = ops[0].changes.find((c) => c.field === "nightLandings");
    expect(nightLdg?.to).toBe("1");
    // The sunrise/sunset evidence rides on the sector for the UI to render —
    // it is no longer stuffed into a prose note on the diff.
    expect(ops[0].sector.toLdgContext?.arrSunsetUtc).toBe("12:50");
    expect(ops[0].sector.toLdgContext?.arrSunStatus).toBe("night");
  });
});

// ============================================================
// Turnaround disambiguation — both legs same date, same aircraft
// ============================================================

describe("reconcileRoster — turnaround matching", () => {
  it("does NOT match a SIN→DVO logbook sector against an existing DVO→SIN flight on same day + same reg", () => {
    // Existing flight: DVO→SIN turn (TR561)
    const dvoSin = makeFlight({
      id: "tr561",
      flightNumber: "TR561",
      departureIata: "DVO",
      arrivalIata: "SIN",
      aircraftReg: "9V-NCE",
      date: "2026-04-08",
    });
    // Existing flight: SIN→DVO turn (TR560)
    const sinDvo = makeFlight({
      id: "tr560",
      flightNumber: "TR560",
      departureIata: "SIN",
      arrivalIata: "DVO",
      aircraftReg: "9V-NCE",
      date: "2026-04-08",
    });

    // Logbook sector for SIN→DVO leg (no flight number, has reg).
    const ops = reconcileRoster({
      sectors: [
        {
          date: "2026-04-08",
          flightNumber: "",
          aircraftType: "A21N",
          departureIata: "SIN",
          arrivalIata: "DVO",
          actualOut: "18:22",
          actualIn: "21:57",
          aircraftReg: "9V-NCE",
          sourceLine: 10,
        },
      ],
      existingFlights: [dvoSin, sinDvo],
      csvDateRange: { start: "2026-04-01", end: "2026-04-30" },
    });

    // Should match TR560, NOT TR561.
    const updateOp = ops.find(
      (o) => o.kind === "update_conflict" || o.kind === "skip_identical"
    );
    expect(updateOp).toBeDefined();
    if (
      updateOp?.kind !== "update_conflict" &&
      updateOp?.kind !== "skip_identical"
    )
      return;
    expect(updateOp.flight.id).toBe("tr560");
    expect(updateOp.flight.flightNumber).toBe("TR560");
  });

  it("falls back to date + arrival + reg when departure was stored wrong (XSP vs SIN)", () => {
    // User's existing TR560 has stale departureIata "XSP" instead of "SIN".
    const tr560StaleDep = makeFlight({
      id: "tr560-stale",
      flightNumber: "TR560",
      departureIata: "XSP",
      arrivalIata: "DVO",
      aircraftReg: "9V-NCE",
      date: "2026-04-08",
    });
    const tr561 = makeFlight({
      id: "tr561",
      flightNumber: "TR561",
      departureIata: "DVO",
      arrivalIata: "SIN",
      aircraftReg: "9V-NCE",
      date: "2026-04-08",
    });

    const ops = reconcileRoster({
      sectors: [
        {
          date: "2026-04-08",
          flightNumber: "",
          aircraftType: "A21N",
          departureIata: "SIN",
          arrivalIata: "DVO",
          actualOut: "18:22",
          actualIn: "21:57",
          aircraftReg: "9V-NCE",
          sourceLine: 10,
        },
      ],
      existingFlights: [tr560StaleDep, tr561],
      csvDateRange: { start: "2026-04-01", end: "2026-04-30" },
    });

    // Should still match TR560 via the arrival+reg fallback so the user can
    // accept the departureIata fix instead of seeing a spurious "missing
    // from roster" delete suggestion.
    const matchOp = ops.find((o) => o.kind === "update_conflict");
    expect(matchOp).toBeDefined();
    if (matchOp?.kind !== "update_conflict") return;
    expect(matchOp.flight.id).toBe("tr560-stale");
    // The diff should include the dep-airport correction.
    expect(matchOp.changes.map((c) => c.field)).toContain("departureIata");
  });
});
