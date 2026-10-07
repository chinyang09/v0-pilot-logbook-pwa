/**
 * The October 2026 Personal Crew Schedule Report, as eCrew issued it (PDF,
 * Local Base), run through the REAL extractor and the schedule parser.
 *
 * Two things went wrong on this file and both are pinned here:
 *
 *  - The PDF prints the next-day marker as a bare, space-separated "¹"
 *    ("02:05 ¹ - 06:30 ¹"), not the CSV's "⁺¹". Unrecognised on a DEPARTURE,
 *    the sector had no OUT time and was dropped — the return leg of both
 *    overnight turnarounds (TR785 VTZ→SIN, TR125 CSX→SIN) never imported.
 *  - With the base airport missing from the local table, a Local Base report
 *    converted every time to nothing, dropped every sector in silence and
 *    offered the matching flights for DELETION. It must refuse instead.
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
  getUserPreferences: vi.fn(async () => null),
  DEFAULT_IMPORT_DEFAULTS: { nonPicPfRole: "SIC" as const },
}));

vi.mock("../shared/airport-enricher", () => ({
  enrichAirportBatch: vi.fn(async () => {}),
}));

import { extractPdfRows } from "../extractors/pdf.extractor";
import { parseScheduleCSV } from "../schedule-parser";
import type { NormalizedDocument } from "../types";

async function loadReport(): Promise<NormalizedDocument> {
  const buf = readFileSync(
    path.join(__dirname, "fixtures/schedule-oct-2026-local-base.pdf")
  );
  const file = new File([buf], "schedule.pdf", { type: "application/pdf" });
  const { rows, rawText } = await extractPdfRows(file);
  return { format: "pdf", reportType: "schedule", rows, rawText };
}

function creates(plan: Awaited<ReturnType<typeof parseScheduleCSV>>) {
  return plan.operations.flatMap((op) => (op.kind === "create" ? [op.sector] : []));
}

describe("schedule PDF — October 2026 report", () => {
  beforeEach(() => {
    knownAirports = airports;
  });

  it("imports every operated sector, including both overnight return legs", async () => {
    const plan = await parseScheduleCSV(await loadReport());

    expect(plan.errors).toEqual([]);
    expect(creates(plan).map((s) => s.flightNumber)).toEqual([
      "TR982",
      "TR983",
      "TR626",
      "TR627",
      "TR784",
      "TR785",
      "TR476",
      "TR477",
      "TR244",
      "TR245",
      "TR124",
      "TR125",
    ]);
    // The two EBT simulator days, at their Training Details times in UTC.
    expect(
      plan.simSessions.map((s) => [s.date, s.outUtc, s.inUtc])
    ).toEqual([
      ["2026-10-13", "01:30", "07:30"],
      ["2026-10-14", "05:15", "11:15"],
    ]);
  });

  it("reads a '¹' on the departure as the next day", async () => {
    const sectors = creates(await parseScheduleCSV(await loadReport()));

    // 07/10 row: 785 VTZ-SIN "02:05 ¹ - 06:30 ¹" Local Base (UTC+8) →
    // 08/10 02:05 SGT = 07/10 18:05Z.
    const tr785 = sectors.find((s) => s.flightNumber === "TR785");
    expect(tr785).toMatchObject({
      date: "2026-10-07",
      departureIcao: "VOVZ",
      arrivalIcao: "WSSS",
      scheduledOut: "18:05",
      scheduledIn: "22:30",
    });

    // 16/10 row: 125 CSX-SIN "00:05 ¹ - 04:40 ¹" → 17/10 00:05 SGT = 16/10 16:05Z.
    const tr125 = sectors.find((s) => s.flightNumber === "TR125");
    expect(tr125).toMatchObject({
      date: "2026-10-16",
      departureIcao: "ZGHA",
      arrivalIcao: "WSSS",
      scheduledOut: "16:05",
      scheduledIn: "20:40",
    });

    // An actual arrival carrying the marker: 983 "A21:56 - A01:27 ¹/01:24".
    const tr983 = sectors.find((s) => s.flightNumber === "TR983");
    expect(tr983).toMatchObject({ actualOut: "13:56", actualIn: "17:27" });
  });

  it("refuses a Local Base report whose base airport cannot be resolved", async () => {
    const { SIN: _base, ...withoutBase } = airports;
    knownAirports = withoutBase;

    const plan = await parseScheduleCSV(await loadReport());

    expect(plan.success).toBe(false);
    expect(plan.errors[0]?.message).toMatch(/base airport \(SIN\)/);
    expect(plan.operations).toEqual([]);
    expect(plan.simSessions).toEqual([]);
  });
});
