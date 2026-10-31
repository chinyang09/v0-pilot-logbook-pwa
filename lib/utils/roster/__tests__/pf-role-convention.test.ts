/**
 * The pilot's PF convention, dated, and the role an import leaves beside a
 * PF/PM value. Pinned by the owner's own logbook audited against the company
 * report: PICUS only from the check-out date, never on a monitoring leg, and
 * a declined PF/PM change must not let its role half through on its own.
 */

import { describe, it, expect } from "vitest";
import { reconcileRoster, type ParsedSector } from "../reconciler";
import { importedSectorRole, nonPicPfRoleOf, pfRoleOn, seatOf, settledRole, withLoggingPreferences } from "../pilot-role";
import type { FlightLog } from "../../../../types/entities/flight.types";

const CHECKOUT = "2025-07-27";

function flight(overrides: Partial<FlightLog> = {}): FlightLog {
  return {
    id: crypto.randomUUID(),
    date: "2025-09-25",
    flightNumber: "TR490",
    aircraftReg: "9V-NCB",
    aircraftType: "A21N",
    departureIcao: "WSSS",
    departureIata: "SIN",
    arrivalIcao: "WBKK",
    arrivalIata: "BKI",
    departureTimezone: 8,
    arrivalTimezone: 8,
    scheduledOut: "02:00",
    scheduledIn: "04:30",
    outTime: "02:04",
    offTime: "",
    onTime: "",
    inTime: "04:28",
    blockTime: "02:24",
    flightTime: "00:00",
    nightTime: "00:00",
    dayTime: "02:24",
    picId: "",
    picName: "",
    sicId: "",
    sicName: "",
    additionalCrew: [],
    pilotFlying: false,
    pilotRole: "SIC",
    picTime: "00:00",
    sicTime: "02:24",
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
    multiPilotTime: "00:00",
    soloTime: "00:00",
    approaches: [],
    holds: 0,
    ipcIcc: false,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    syncStatus: "synced",
    ...overrides,
  };
}

function sector(overrides: Partial<ParsedSector> = {}): ParsedSector {
  return {
    date: "2025-09-25",
    flightNumber: "TR490",
    aircraftType: "A21N",
    aircraftReg: "9V-NCB",
    departureIata: "SIN",
    arrivalIata: "BKI",
    actualOut: "02:04",
    actualIn: "04:28",
    sourceLine: 1,
    ...overrides,
  };
}

function roleChange(f: FlightLog, s: ParsedSector, pfRoleFrom: string | null = CHECKOUT) {
  const ops = reconcileRoster({
    sectors: [s],
    existingFlights: [f],
    csvDateRange: { start: "2025-03-01", end: "2026-11-30" },
    nonPicPfRole: "PICUS",
    pfRoleFrom,
    useLegacyUpdateConflict: false,
  });
  const op = ops[0];
  const changes = "changes" in op ? op.changes ?? [] : [];
  return {
    kind: op.kind,
    pf: changes.find((c) => c.field === "pilotFlying")?.to,
    role: changes.find((c) => c.field === "pilotRole")?.to,
  };
}

describe("the PF convention is dated", () => {
  it("is SIC before the check-out and the convention from it", () => {
    expect(pfRoleOn("PICUS", CHECKOUT, "2025-07-26")).toBe("SIC");
    expect(pfRoleOn("PICUS", CHECKOUT, CHECKOUT)).toBe("PICUS");
    expect(pfRoleOn("PICUS", CHECKOUT, "2026-01-01")).toBe("PICUS");
  });

  it("applies as written with no check-out or no date", () => {
    expect(pfRoleOn("PICUS", null, "2020-01-01")).toBe("PICUS");
    expect(pfRoleOn("PICUS", CHECKOUT, undefined)).toBe("PICUS");
    expect(pfRoleOn("SIC", CHECKOUT, "2026-01-01")).toBe("SIC");
  });

  it("reads the check-out off the self card", () => {
    const card = { pfRole: "PICUS" as const, pfRoleFrom: CHECKOUT };
    expect(nonPicPfRoleOf(card, null, "2025-06-21")).toBe("SIC");
    expect(nonPicPfRoleOf(card, null, "2025-09-25")).toBe("PICUS");
  });
});

describe("settledRole", () => {
  const conv = { convention: "PICUS" as const };
  it("never leaves PICUS on a monitoring leg", () => {
    expect(settledRole({ currentRole: "PICUS", pilotFlying: false, ...conv, onDate: "PICUS" })).toBe("SIC");
  });
  it("logs a flown leg PICUS for a pilot who does, from the check-out", () => {
    expect(settledRole({ currentRole: "SIC", pilotFlying: true, ...conv, onDate: "PICUS" })).toBe("PICUS");
  });
  it("takes PICUS back off a leg flown before the check-out", () => {
    expect(settledRole({ currentRole: "PICUS", pilotFlying: true, ...conv, onDate: "SIC" })).toBe("SIC");
  });
  it("leaves a one-off PICUS alone for a pilot whose convention is SIC", () => {
    expect(
      settledRole({ currentRole: "PICUS", pilotFlying: true, convention: "SIC", onDate: "SIC" })
    ).toBe("PICUS");
  });
  it("never touches a captain", () => {
    expect(settledRole({ currentRole: "PIC", pilotFlying: false, ...conv, onDate: "PICUS" })).toBe("PIC");
  });
});

describe("reconcileRoster — the role beside PF/PM", () => {
  it("a report making the leg PF promotes the role only from the check-out", () => {
    const report = sector({ isPilotFlying: true, dayTakeoffs: 1, dayLandings: 1 });
    expect(roleChange(flight(), report)).toMatchObject({ pf: "true", role: "PICUS" });
    const early = flight({ date: "2025-06-21" });
    expect(roleChange(early, { ...report, date: "2025-06-21" })).toMatchObject({ pf: "true", role: undefined });
    // A PM leg an earlier build logged PICUS, made PF before the check-out: SIC.
    const earlyPicus = flight({ date: "2025-06-21", pilotRole: "PICUS" });
    expect(roleChange(earlyPicus, { ...report, date: "2025-06-21" })).toMatchObject({ pf: "true", role: "SIC" });
  });

  it("offers to put right a PF + SIC leg whose PF/PM already agrees", () => {
    const f = flight({ pilotFlying: true, pilotRole: "SIC" });
    expect(roleChange(f, sector({ isPilotFlying: true, dayTakeoffs: 1, dayLandings: 1 }))).toMatchObject({
      pf: undefined,
      role: "PICUS",
    });
  });

  it("offers to put right PM + PICUS", () => {
    const f = flight({ pilotFlying: false, pilotRole: "PICUS" });
    expect(roleChange(f, sector({ isPilotFlying: false }))).toMatchObject({ pf: undefined, role: "SIC" });
  });

  it("a declined PF change does not let its role half through — the role follows the KEPT PF", () => {
    // The owner's TR490: PF=true turned down at one import, the PICUS that
    // came with it accepted at the next, leaving a PM leg logged PICUS.
    const f = flight({
      pilotFlying: false,
      pilotRole: "SIC",
      importDecisions: { pilotFlying: { declined: "true", at: Date.now() } },
    });
    const r = roleChange(f, sector({ isPilotFlying: true, dayTakeoffs: 1, dayLandings: 1 }));
    expect(r.pf).toBeUndefined();
    expect(r.role).toBeUndefined();

    // And a flight an earlier build already left PM + PICUS is offered SIC.
    const broken = flight({ ...f, pilotRole: "PICUS" });
    expect(roleChange(broken, sector({ isPilotFlying: true, dayTakeoffs: 1, dayLandings: 1 })).role).toBe("SIC");
  });
});

describe("withLoggingPreferences — the convention is a USER setting, not a fixed rule", () => {
  const card = { defaultPIC: false, defaultSIC: true, roles: ["SIC" as const], pfRole: null, pfRoleFrom: null as string | null };

  it("leaves a first officer SIC when flying unless the pilot chose PICUS", () => {
    const self = withLoggingPreferences(card, { seat: null, pfRole: null, pfRoleFrom: null });
    expect(nonPicPfRoleOf(self, undefined, "2026-01-01")).toBe("SIC");
  });

  it("takes the settings over the card, value by value, dated by the check-out", () => {
    const self = withLoggingPreferences(card, { seat: null, pfRole: "PICUS", pfRoleFrom: "2025-07-27" });
    expect(seatOf(self)).toBe("first_officer");
    expect(nonPicPfRoleOf(self, undefined, "2025-07-26")).toBe("SIC");
    expect(nonPicPfRoleOf(self, undefined, "2025-07-27")).toBe("PICUS");
  });

  it("falls back to the card for whatever the settings leave unset", () => {
    const self = withLoggingPreferences({ ...card, pfRole: "PICUS" as const, pfRoleFrom: "2025-07-27" }, { seat: "captain", pfRole: null, pfRoleFrom: null });
    expect(seatOf(self)).toBe("captain");
    expect(self?.pfRole).toBe("PICUS");
    expect(self?.pfRoleFrom).toBe("2025-07-27");
  });

  it("reads an explicit empty check-out date as 'no date', not the card's", () => {
    const self = withLoggingPreferences({ ...card, pfRoleFrom: "2025-07-27" }, { seat: null, pfRole: "PICUS", pfRoleFrom: "" });
    expect(self?.pfRoleFrom).toBeNull();
    expect(nonPicPfRoleOf(self, undefined, "2020-01-01")).toBe("PICUS");
  });
});

describe("a schedule report (no PF/PM in it)", () => {
  it("creates a flown leg in the pilot's convention, not PF + SIC", () => {
    const base = { reportSaysPic: false, reportSaysNotPic: false, pilotFlying: true }
    expect(importedSectorRole({ ...base, seat: "first_officer", nonPicPfRole: "PICUS" })).toBe("PICUS")
    expect(importedSectorRole({ ...base, seat: "first_officer", nonPicPfRole: "SIC" })).toBe("SIC")
    expect(importedSectorRole({ ...base, seat: "captain", nonPicPfRole: "PICUS" })).toBe("PIC")
  })

  it("follows the report where it names the commander", () => {
    const base = { pilotFlying: true, seat: "captain" as const, nonPicPfRole: "PICUS" as const }
    expect(importedSectorRole({ ...base, reportSaysPic: true, reportSaysNotPic: false })).toBe("PIC")
    expect(importedSectorRole({ ...base, reportSaysPic: false, reportSaysNotPic: true })).toBe("PICUS")
    expect(importedSectorRole({ ...base, reportSaysPic: false, reportSaysNotPic: true, pilotFlying: false })).toBe("SIC")
  })

  it("offers to put right a PF + SIC leg an earlier import left, judged on the flight's own PF", () => {
    expect(roleChange(flight({ pilotFlying: true, pilotRole: "SIC" }), sector()).role).toBe("PICUS")
    // Before the check-out SIC is right, and a monitored leg is left alone.
    expect(roleChange(flight({ date: "2025-06-21", pilotFlying: true, pilotRole: "SIC" }), sector({ date: "2025-06-21" })).role).toBeUndefined()
    expect(roleChange(flight({ pilotFlying: false, pilotRole: "SIC" }), sector()).role).toBeUndefined()
  })
})
