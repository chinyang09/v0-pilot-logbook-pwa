/**
 * The October 2026 Personal Crew Schedule Report (PDF, Local Base), as the
 * PDF extractor emits it — one row per Y-bucket, Y values and cell layout
 * copied from the real report, crew names replaced. Run through the schedule
 * parser.
 *
 * Two things went wrong on this report and both are pinned here:
 *
 *  - The PDF prints the next-day marker as a bare, space-separated "¹"
 *    ("02:05 ¹ - 06:30 ¹"), not the CSV's "⁺¹". Unrecognised on a DEPARTURE,
 *    the sector had no OUT time and was dropped — the return leg of both
 *    overnight turnarounds (TR785 VTZ→SIN, TR125 CSX→SIN) never imported.
 *  - With the base airport missing from the local table, a Local Base report
 *    converted every time to nothing, dropped every sector in silence and
 *    offered the matching flights for DELETION. It must refuse instead.
 *
 * TR627R (BKK→BKK) is deliberately NOT a sector: it is a closed-and-reopened
 * flight, not a movement to log, and the "\d+R" duty code does not match.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { parseScheduleCSV } from "../schedule-parser";
import type { NormalizedDocument, NormalizedRow } from "../types";

/** One extractor row: [y, cells]. */
type R = [number, string[]];
const S = (...cells: string[]) => cells;
/** A schedule-table row: date, duties, details, report, actual, debrief, indicators, crew. */
const T = (
  date = "",
  duties = "",
  details = "",
  report = "",
  actual = "",
  debrief = "",
  crew = ""
) => [date, duties, details, report, actual, debrief, "", crew];
const CREW = (name: string) => T("", "", "", "", "", "", name);
const HEADER = S("Date", "Duties", "Details", "Report times", "Actual times/Delays", "Debrief times", "Indicators", "Crew");
const BANNER: R[] = [
  [561.2, S("", "", "", "Personal Crew Schedule Report", "", "", "", "")],
  [559.3, S("Scoot Pte Ltd", "", "", "", "", "", "", "")],
  [531.2, S("", "", "01/10/2026 - 31/10/2026 (All times in Local Base)", "", "", "", "", "")],
];
const FOOTER = (page: number): R => [
  25.9,
  S("Generated on Oct 07, 2026 16:54", "", "", "", "", "", "", "", `Page ${page} of 3`),
];

const PAGES: R[][] = [
  [
    ...BANNER,
    [502.1, S("9766 Lim Chin Yang SIN-FO-318,319,320,32N,32Q", "", "", "", "", "", "", "")],
    [469.5, S("Schedule Details", "", "", "", "", "", "", "")],
    [448.6, HEADER],
    [374.4, T("04/10/2026 Sun", "CSL", "Sick Leave")],
    [360.1, CREW("CPT - PIC - 1001 - Captain One")],
    [350.5, CREW("FO - 9766 - Lim Chin Yang")],
    [331.2, T("", "982 [32Q]", "SIN - HKG", "", "A16:49 - A20:45")],
    [325.8, T("05/10/2026 Mon", "", "", "15:05", "", "01:57 ¹")],
    [321.6, T("", "983 [32Q]", "HKG - SIN", "", "A21:56 - A01:27 ¹/01:24", "", "CC - 2001 - Cabin One")],
    [312.0, CREW("CC - 2002 - Cabin Two")],
    [281.3, CREW("CPT - PIC - 1002 - Captain Two")],
    [271.7, CREW("FO - 9766 - Lim Chin Yang")],
    [262.1, T("", "626 [32N]", "SIN - BKK", "", "A18:07 - A20:34", "", "CL - 2003 - Cabin Three")],
    [251.8, T("06/10/2026 Tue", "627R [32N]", "BKK - BKK", "17:00", "A21:39 - A22:02", "01:31 ¹", "CC - 2004 - Cabin Four")],
    [242.8, T("", "627 [32N]", "BKK - SIN", "", "A22:29 - A01:01 ¹/00:07")],
    [233.2, CREW("CC - 2005 - Cabin Five")],
    [212.1, CREW("CPT - PIC - 1003 - Captain Three")],
    [192.9, CREW("FO - 9766 - Lim Chin Yang")],
    [183.3, T("", "784 [32N]", "SIN - VTZ", "", "21:15 - 01:20 ¹", "", "CL - 2006 - Cabin Six")],
    [177.9, T("07/10/2026 Wed", "", "", "20:15", "", "07:00 ¹")],
    [173.7, T("", "785 [32N]", "VTZ - SIN", "", "02:05 ¹ - 06:30 ¹")],
    [164.0, CREW("CC - 2007 - Cabin Seven")],
    [129.3, T("09/10/2026 Fri", "LOFF", "Local Day Off for Tech Crew")],
    FOOTER(1),
  ],
  [
    ...BANNER,
    [489.6, S("Schedule Details", "", "", "", "", "", "", "")],
    [468.7, HEADER],
    [449.6, T("13/10/2026 Tue", "EBTO", "EBT Day 1 (OPC Cycle)", "", "10:30 - 14:30")],
    [431.3, T("14/10/2026 Wed", "EBT2", "EBT Day 2", "", "14:45 - 18:45")],
    [417.0, CREW("CPT - PIC - 1004 - Captain Four")],
    [397.7, T("", "476 [320]", "SIN - LGK", "", "09:20 - 10:50", "", "FO - 9766 - Lim Chin Yang")],
    [388.1, T("", "477 [320]", "LGK - SIN", "", "11:40 - 13:30", "", "CL - 2008 - Cabin Eight")],
    [382.7, T("15/10/2026 Thu", "", "", "08:20", "", "19:00")],
    [378.5, T("", "244 [320]", "SIN - KNO", "", "14:45 - 16:15", "", "CC - 2009 - Cabin Nine")],
    [368.8, T("", "245 [320]", "KNO - SIN", "", "17:00 - 18:30", "", "CC - 2010 - Cabin Ten")],
    [338.2, CREW("CPT - PIC - 1005 - Captain Five")],
    [318.9, CREW("FO - 9766 - Lim Chin Yang")],
    [309.3, CREW("CL - 2011 - Cabin Eleven")],
    [304.5, T("", "124 [32Q]", "SIN - CSX", "", "18:10 - 23:05")],
    [299.1, T("16/10/2026 Fri", "", "", "17:10", "", "05:10 ¹", "CC - 2012 - Cabin Twelve")],
    [294.9, T("", "125 [32Q]", "CSX - SIN", "", "00:05 ¹ - 04:40 ¹")],
    [290.1, CREW("CC - 2013 - Cabin Thirteen")],
    [245.7, T("18/10/2026 Sun", "LOFF", "Local Day Off for Tech Crew")],
    FOOTER(2),
  ],
  [
    ...BANNER,
    [552.0, S("Total Hours and Statistics", "", "", "", "", "", "", "")],
    [522.0, S("Code", "", "", "Description", "", "Expiry Date", "", "")],
    [512.0, S("MEDIC", "", "", "MEDICAL", "", "31/01/2027", "", "")],
    [502.3, S("Training Details", "", "", "", "", "", "")],
    [482.1, S("Date", "Time", "Duty", "Crew", "Course Name", "Course Component", "Facility")],
    [466.3, S("", "", "", "", "", "", "Name: AATC SIM B")],
    [442.3, S("", "", "", "731 -- Instructor One -- Instructor", "", "", "")],
    [432.1, S("13/10/2026", "0930 - 1530", "SMCK EBT1 D1", "9766 -- Lim Chin Yang -- Trainee", "A320 EBT1 (Oct 13)", "SMCK EBT1 D1", "")],
    [387.9, S("", "", "", "", "", "", "Name: AATC SIM B")],
    [363.8, S("", "", "", "2712 -- Instructor Two -- Instructor", "", "", "")],
    [353.6, S("14/10/2026", "1315 - 1915", "SMTR EBT1 D2", "9766 -- Lim Chin Yang -- Trainee", "A320 EBT1 (Oct 13)", "SMTR EBT1 D2", "")],
    FOOTER(3),
  ],
];

async function loadReport(): Promise<NormalizedDocument> {
  const rows: NormalizedRow[] = PAGES.flat().map(([y, cells], index) => ({
    index,
    raw: cells.join(","),
    cells,
    y,
  }));
  return {
    format: "pdf",
    reportType: "schedule",
    rows,
    rawText: rows.map((r) => r.raw).join("\n"),
  };
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
