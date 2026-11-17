/**
 * The October 2026 schedule report's "Total Hours and Statistics", checked
 * against the figures the app works out from the same report's flights,
 * simulator days and days off — through the REAL parser and the REAL FDP
 * pipeline. The report is actual + planned (generated 7 Oct): flown sectors
 * at their actual times, the rest at their schedule, a return to ramp
 * (627R, BKK-BKK) in the block but not the landings. If the app ever stores
 * a duty or a block differently from the company, this is where it shows.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const airports: Record<string, { tz: string; icao: string }> = {
  SIN: { tz: "Asia/Singapore", icao: "WSSS" },
  HKG: { tz: "Asia/Hong_Kong", icao: "VHHH" },
  BKK: { tz: "Asia/Bangkok", icao: "VTBS" },
  VTZ: { tz: "Asia/Kolkata", icao: "VOVZ" },
  LGK: { tz: "Asia/Kuala_Lumpur", icao: "WMKL" },
  KNO: { tz: "Asia/Jakarta", icao: "WIMM" },
  CSX: { tz: "Asia/Shanghai", icao: "ZGHA" },
};
let knownAirports = airports;

vi.mock("@/lib/db", () => ({
  userDb: { flights: { toArray: vi.fn(async () => []) } },
  isLiveFlight: (f: { deletedAt?: number }) => f.deletedAt === undefined,
  getAirportByIata: vi.fn(
    async (iata: string) => knownAirports[iata?.toUpperCase()] ?? null
  ),
  // Every zone sims and ground duties use here is the SIN base.
  getAirportTimeInfo: vi.fn(() => ({ offset: 8 })),
  getAllPersonnel: vi.fn(async () => []),
  getCurrentUserPersonnel: vi.fn(async () => ({
    id: "self",
    name: "Lim Chin Yang",
    crewId: "9766",
    organization: "Scoot",
    roles: ["SIC"],
    isMe: true,
    createdAt: 0,
    syncStatus: "pending" as const,
  })),
  getLoggingProfile: vi.fn(async () => ({
    id: "self",
    name: "Lim Chin Yang",
    crewId: "9766",
    organization: "Scoot",
    roles: ["SIC"],
    isMe: true,
    createdAt: 0,
    syncStatus: "pending" as const,
  })),
  getUserPreferences: vi.fn(async () => null),
  DEFAULT_IMPORT_DEFAULTS: { nonPicPfRole: "SIC" as const },
}));

vi.mock("../shared/airport-enricher", () => ({
  enrichAirportBatch: vi.fn(async () => {}),
}));

import { extractPdfRows } from "../extractors/pdf.extractor";
import { parseScheduleCSV } from "../schedule-parser";
import { runFDPPipeline } from "@/lib/utils/roster/fdp-pipeline";
import { compareReportTotals, logbookTotals, readReportTotals } from "@/lib/utils/roster/report-totals";
import type { FlightLog } from "@/types/entities/flight.types";
import type { ScheduleEntry } from "@/types/entities/roster.types";

async function plan() {
  const buf = readFileSync(path.join(__dirname, "fixtures/schedule-oct-2026-local-base.pdf"));
  const file = new File([buf], "schedule.pdf", { type: "application/pdf" });
  const { rows, rawText } = await extractPdfRows(file);
  return { rows, plan: await parseScheduleCSV({ format: "pdf", reportType: "schedule", rows, rawText }) };
}

const span = (a: string, b: string) => {
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const d = m(b) - m(a);
  const v = d < 0 ? d + 1440 : d;
  return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
};

/** What the import writes, reduced to the fields the totals read. */
function logbookFrom(p: Awaited<ReturnType<typeof plan>>["plan"]) {
  const flights: FlightLog[] = [];
  for (const op of p.operations) {
    if (op.kind !== "create") continue;
    const s = op.sector;
    flights.push({
      id: `${s.date}-${s.flightNumber}-${s.actualOut || s.scheduledOut}`,
      date: s.date,
      flightNumber: s.flightNumber,
      departureIata: s.departureIata,
      arrivalIata: s.arrivalIata,
      departureIcao: s.departureIcao ?? "",
      arrivalIcao: s.arrivalIcao ?? "",
      outTime: s.actualOut ?? "",
      inTime: s.actualIn ?? "",
      offTime: "",
      onTime: "",
      scheduledOut: s.scheduledOut ?? "",
      scheduledIn: s.scheduledIn ?? "",
      reportTime: s.reportTime,
      blockTime: s.actualOut && s.actualIn ? span(s.actualOut, s.actualIn) : "00:00",
      entryType: "flight",
      isSimulator: false,
    } as unknown as FlightLog);
  }
  for (const sim of p.simSessions) {
    flights.push({
      id: `sim-${sim.date}`,
      date: sim.date,
      flightNumber: "",
      departureIata: "",
      arrivalIata: "",
      outTime: sim.outUtc,
      inTime: sim.inUtc,
      scheduledOut: "",
      scheduledIn: "",
      blockTime: "00:00",
      simulatedInstrumentTime: span(sim.outUtc ?? "00:00", sim.inUtc ?? "00:00"),
      entryType: "simulator",
      isSimulator: true,
    } as unknown as FlightLog);
  }
  const entries = p.groundDuties.map(
    (g, i) =>
      ({
        id: `g${i}`,
        date: g.date,
        dutyType: g.dutyType,
        dutyCode: g.dutyCode,
        dutyDescription: g.description,
        reportTime: g.startTime,
        debriefTime: g.endTime,
        sectors: [],
        timeReference: "UTC",
      }) as unknown as ScheduleEntry,
  );
  return { flights, entries };
}

describe("schedule report totals — October 2026", () => {
  it("reads the totals block", async () => {
    const { plan: p } = await plan();
    expect(p.reportTotals?.figures).toEqual({
      blockMinutes: 37 * 60 + 9,
      dutyMinutes: 64 * 60 + 48,
      awayMinutes: 52 * 60 + 48,
      offDays: 22,
      flightDays: 5,
      trainingDays: 2,
      landings: 12,
    });
  });

  it("keeps the return to ramp as a sector of its own", async () => {
    const { plan: p } = await plan();
    const rtr = p.operations.flatMap((op) => (op.kind === "create" ? [op.sector] : [])).find((s) => s.flightNumber === "TR627R");
    expect(rtr).toMatchObject({ departureIata: "BKK", arrivalIata: "BKK", actualOut: "13:39", actualIn: "14:02" });
    // The report column: 5 Oct's report was moved to 15:05 local (07:05Z)
    // for the delay, and only the duty's FIRST sector carries it.
    const sectors = p.operations.flatMap((op) => (op.kind === "create" ? [op.sector] : []));
    expect(sectors.filter((s) => s.reportTime).map((s) => [s.flightNumber, s.reportTime])).toEqual([
      ["TR982", "07:05"],
      ["TR626", "09:00"],
      ["TR784", "12:15"],
      ["TR476", "00:20"],
      ["TR124", "09:10"],
    ]);
  });

  it("the logbook built from it comes to the same figures, through the FDP pipeline", async () => {
    const { plan: p } = await plan();
    const { flights, entries } = logbookFrom(p);
    // As of the report's generation: everything after it is the plan.
    const now = Date.parse("2026-10-07T12:00:00Z");
    const fdp = runFDPPipeline(flights, entries, new Map(), now);
    const ours = logbookTotals({
      flights,
      scheduleEntries: entries,
      dutyPeriods: fdp.allDutyPeriods,
      range: p.dateRange,
    });
    const cmp = compareReportTotals(p.reportTotals!.figures, ours);
    expect(cmp.rows.filter((r) => r.delta !== 0)).toEqual([]);
    expect(cmp.matches).toBe(true);
  });

  it("reads nothing from a block it cannot read cleanly", () => {
    expect(readReportTotals([{ raw: "Block Hours,Duty Hours,Landings" }, { raw: "37:09,64:48" }])).toBeNull();
    expect(readReportTotals([{ raw: "nothing here" }])).toBeNull();
  });
});
