/**
 * Tests for the PDF Y-bucket merge in the schedule parser.
 *
 * The Scoot schedule PDF lays out each visual table entry across 3 - 10
 * Y-buckets: the date row sits in the MIDDLE of the entry, with the top
 * sector + part of the crew rendered above and the bottom sector + the
 * rest of the crew rendered below. The PDF extractor turns each Y-bucket
 * into one NormalizedRow, so without merging the parser only sees a row
 * that has a date (the middle one) and never reaches the sectors that
 * live above or below. The result, on a multi-sector month, was every
 * existing flight in the logbook getting flagged as "Missing from roster".
 *
 * These tests construct synthetic NormalizedRows that mirror the real
 * extractor output and check that the parser recovers BOTH sectors of a
 * turnaround day.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NormalizedDocument, NormalizedRow } from "../types";

// We have to stub `@/lib/db` because the parser pulls real IndexedDB helpers
// in at module-eval time. The stubs cover everything the parser touches:
// the user profile lookup, the airport lookup, and personnel listing.
vi.mock("@/lib/db", () => {
  const airports: Record<string, { tz: string; icao: string }> = {
    SIN: { tz: "Asia/Singapore", icao: "WSSS" },
    CGK: { tz: "Asia/Jakarta", icao: "WIII" },
    FOC: { tz: "Asia/Shanghai", icao: "ZSFZ" },
    MNL: { tz: "Asia/Manila", icao: "RPLL" },
    CJU: { tz: "Asia/Seoul", icao: "RKPC" },
    CEB: { tz: "Asia/Manila", icao: "RPVM" },
    KCH: { tz: "Asia/Kuching", icao: "WBGG" },
    DPS: { tz: "Asia/Makassar", icao: "WADD" },
    KUL: { tz: "Asia/Kuala_Lumpur", icao: "WMKK" },
    KMG: { tz: "Asia/Shanghai", icao: "ZPPP" },
  };
  return {
    userDb: {
      flights: { toArray: vi.fn(async () => []) },
    },
    getAirportByIata: vi.fn(async (iata: string) => airports[iata?.toUpperCase()] ?? null),
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
    // The parser reads the user's PICUS-vs-SIC convention so a PF/PM change
    // can carry the matching pilotRole correction.
    getUserPreferences: vi.fn(async () => null),
    DEFAULT_IMPORT_DEFAULTS: { nonPicPfRole: "SIC" as const },
  };
});

vi.mock("../shared/airport-enricher", () => ({
  enrichAirportBatch: vi.fn(async () => {}),
}));

import { parseScheduleCSV } from "../schedule-parser";

/**
 * Build a NormalizedRow shaped like the PDF extractor produces. `cells` is
 * positional: [date, duties, details, report, actual, debrief, indicator, crew].
 */
function row(y: number, cells: (string | undefined)[]): NormalizedRow {
  const filled = new Array(8).fill("");
  for (let i = 0; i < cells.length && i < 8; i++) {
    if (cells[i] !== undefined) filled[i] = cells[i]!;
  }
  return {
    index: 0,
    raw: filled.join(","),
    cells: filled,
    y,
  };
}

function fixedIndexes(rows: NormalizedRow[]): NormalizedRow[] {
  return rows.map((r, i) => ({ ...r, index: i }));
}

/**
 * Synthesize the rows the PDF extractor produces for a single-page schedule
 * report containing exactly one turnaround day (01/06/2026 TR278/TR279).
 * Y values are taken from a real Scoot PDF (page 1 of the 06/2026 report).
 */
function buildSingleTurnaroundDoc(): NormalizedDocument {
  const rows: NormalizedRow[] = [
    row(559, ["Scoot Pte Ltd"]),
    row(531, ["", "", "", "01/06/2026 - 30/06/2026 (All times in Local Base)"]),
    row(502, ["9766 Lim Chin Yang SIN-FO-32N"]),
    row(469, ["Schedule Details"]),
    // Column header
    row(448, [
      "Date",
      "Duties",
      "Details",
      "Report times",
      "Actual times/Delays",
      "Debrief times",
      "Indicators",
      "Crew",
    ]),
    // Crew above date row
    row(433, ["", "", "", "", "", "", "", "CPT - PIC - 10123 - Kee Khiok Wei"]),
    row(424, ["", "", "", "", "", "", "", "Kenneth"]),
    row(414, ["", "", "", "", "", "", "", "FO - 9766 - Lim Chin Yang"]),
    row(404, ["", "", "", "", "", "", "", "CL - 6995 - Yang Teck Seng"]),
    // Top sector
    row(399, ["", "278 [32Q]", "SIN - CGK", "", "A18:25 - A20:14", "", "", ""]),
    // Date row
    row(394, [
      "01/06/2026 Mon",
      "",
      "",
      "17:15",
      "",
      "23:35",
      "",
      "CC - 7944 - Afiq Ali Khan Bin Ameer",
    ]),
    // Bottom sector
    row(390, ["", "279 [32Q]", "CGK - SIN", "", "A21:19 - 23:05/00:10", "", "", ""]),
    // Crew below date row
    row(385, ["", "", "", "", "", "", "", "Ali Khan"]),
    row(375, ["", "", "", "", "", "", "", "CC - 9282 - Khoo Xin Ru"]),
    row(366, ["", "", "", "", "", "", "", "CC - 9366 - Dinda Nadina Binte Mashud"]),
    row(356, ["", "", "", "", "", "", "", "CC - 9594 - Kim Tae Yeon"]),
    // Footer
    row(25, ["Generated on Jun 06, 2026 21:42"]),
  ];
  const indexed = fixedIndexes(rows);
  return {
    format: "pdf",
    reportType: "schedule",
    rows: indexed,
    rawText: indexed.map((r) => r.raw).join("\n"),
  };
}

describe("schedule parser — PDF Y-bucket merging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits BOTH sectors of a turnaround day from the merged PDF rows", async () => {
    const plan = await parseScheduleCSV(buildSingleTurnaroundDoc());

    expect(plan.errors).toEqual([]);
    expect(plan.timeReference).toBe("LOCAL_BASE");
    expect(plan.dateRange).toEqual({ start: "2026-06-01", end: "2026-06-30" });
    expect(plan.generatedAt).not.toBeNull();

    const creates = plan.operations.filter((op) => op.kind === "create");
    expect(creates).toHaveLength(2);

    const flightNumbers = creates
      .map((op) => (op.kind === "create" ? op.sector.flightNumber : ""))
      .sort();
    expect(flightNumbers).toEqual(["TR278", "TR279"]);

    // SIN→CGK is the first sector. 18:25 SGT (Local Base, UTC+8) on
    // 01/06 → 10:25 UTC on 01/06.
    const tr278 = creates.find(
      (op) => op.kind === "create" && op.sector.flightNumber === "TR278"
    );
    if (tr278?.kind !== "create") throw new Error("TR278 missing");
    expect(tr278.sector.date).toBe("2026-06-01");
    expect(tr278.sector.departureIata).toBe("SIN");
    expect(tr278.sector.arrivalIata).toBe("CGK");
    expect(tr278.sector.actualOut).toBe("10:25");
    expect(tr278.sector.actualIn).toBe("12:14");
    expect(tr278.sector.aircraftType).toBe("A21N");
    // ICAO threaded through from the airport DB so the review modal can
    // honour the user's display preference.
    expect(tr278.sector.departureIcao).toBe("WSSS");
    expect(tr278.sector.arrivalIcao).toBe("WIII");

    // CGK→SIN is the return sector. Actual OUT 21:19 SGT → 13:19 UTC,
    // scheduled IN "23:05" (no 'A') → 15:05 UTC.
    const tr279 = creates.find(
      (op) => op.kind === "create" && op.sector.flightNumber === "TR279"
    );
    if (tr279?.kind !== "create") throw new Error("TR279 missing");
    expect(tr279.sector.date).toBe("2026-06-01");
    expect(tr279.sector.departureIata).toBe("CGK");
    expect(tr279.sector.arrivalIata).toBe("SIN");
    expect(tr279.sector.actualOut).toBe("13:19");
    expect(tr279.sector.scheduledIn).toBe("15:05");
  });

  it("attaches crew to BOTH sectors of the merged date block", async () => {
    const plan = await parseScheduleCSV(buildSingleTurnaroundDoc());
    const creates = plan.operations.filter((op) => op.kind === "create");
    for (const op of creates) {
      if (op.kind !== "create") continue;
      const captain = op.sector.crew?.find((c) => c.role === "PIC" || c.role === "CPT");
      const fo = op.sector.crew?.find((c) => c.role === "FO");
      expect(captain?.name).toContain("Kee Khiok Wei");
      expect(fo?.crewId).toBe("9766");
    }
  });

  it("handles a +1 day rollover on the merged row (TR828 SIN-CJU)", async () => {
    // Single-sector duty rendered on a single Y-bucket — exercises the
    // PDF.rawTime path with the ⁺¹ marker AND validates the row passes
    // through the merge step unchanged when there's only one row in the
    // block.
    const rows: NormalizedRow[] = [
      row(559, ["Scoot Pte Ltd"]),
      row(531, ["", "", "", "08/06/2026 - 08/06/2026 (All times in Local Base)"]),
      row(502, ["9766 Lim Chin Yang SIN-FO-32N"]),
      row(469, ["Schedule Details"]),
      row(448, [
        "Date",
        "Duties",
        "Details",
        "Report times",
        "Actual times/Delays",
        "Debrief times",
        "Indicators",
        "Crew",
      ]),
      row(419, [
        "08/06/2026 Mon",
        "828 [32N]",
        "SIN - CJU",
        "23:35",
        "00:35⁺¹ - 06:40⁺¹",
        "07:10⁺¹",
        "",
        "",
      ]),
      row(25, ["Generated on Jun 06, 2026 21:42"]),
    ];
    const doc: NormalizedDocument = {
      format: "pdf",
      reportType: "schedule",
      rows: fixedIndexes(rows),
      rawText: rows.map((r) => r.raw).join("\n"),
    };

    const plan = await parseScheduleCSV(doc);
    expect(plan.errors).toEqual([]);
    const creates = plan.operations.filter((op) => op.kind === "create");
    expect(creates).toHaveLength(1);
    const op = creates[0];
    if (op.kind !== "create") throw new Error("expected create");
    // 00:35 SGT on 09/06 → 16:35 UTC on 08/06.
    expect(op.sector.date).toBe("2026-06-08");
    expect(op.sector.scheduledOut).toBe("16:35");
    // 06:40 SGT on 09/06 → 22:40 UTC on 08/06.
    expect(op.sector.scheduledIn).toBe("22:40");
  });

  it("does not bleed page-header artifacts between blocks", async () => {
    // Two single-sector duties separated by a synthetic page break.
    const rows: NormalizedRow[] = [
      row(559, ["Scoot Pte Ltd"]),
      row(531, ["", "", "", "01/06/2026 - 30/06/2026 (All times in Local Base)"]),
      row(502, ["9766 Lim Chin Yang SIN-FO-32N"]),
      row(469, ["Schedule Details"]),
      row(448, [
        "Date",
        "Duties",
        "Details",
        "Report times",
        "Actual times/Delays",
        "Debrief times",
        "Indicators",
        "Crew",
      ]),
      // First entry on page 1.
      row(400, [
        "08/06/2026 Mon",
        "828 [32N]",
        "SIN - CJU",
        "23:35",
        "00:35⁺¹ - 06:40⁺¹",
        "07:10⁺¹",
      ]),
      row(25, ["Generated on Jun 06, 2026 21:42"]),
      // Page 2 header rows — these should not pollute the first block.
      row(561, ["", "", "", "Personal Crew Schedule Report"]),
      row(559, ["Scoot Pte Ltd"]),
      row(531, ["", "", "", "01/06/2026 - 30/06/2026 (All times in Local Base)"]),
      row(489, ["Schedule Details"]),
      row(468, [
        "Date",
        "Duties",
        "Details",
        "Report times",
        "Actual times/Delays",
        "Debrief times",
        "Indicators",
        "Crew",
      ]),
      // Second entry on page 2.
      row(340, [
        "10/06/2026 Wed",
        "829 [32N]",
        "CJU - SIN",
        "07:30",
        "08:30 - 14:35",
        "15:05",
      ]),
      row(25, ["Generated on Jun 06, 2026 21:42"]),
    ];
    const doc: NormalizedDocument = {
      format: "pdf",
      reportType: "schedule",
      rows: fixedIndexes(rows),
      rawText: rows.map((r) => r.raw).join("\n"),
    };
    const plan = await parseScheduleCSV(doc);
    expect(plan.errors).toEqual([]);
    const creates = plan.operations.filter((op) => op.kind === "create");
    expect(creates).toHaveLength(2);
    const flightNumbers = creates
      .map((op) => (op.kind === "create" ? op.sector.flightNumber : ""))
      .sort();
    expect(flightNumbers).toEqual(["TR828", "TR829"]);
  });
});
