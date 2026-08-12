/**
 * The two header facts a schedule report must establish before ANY of its
 * times or flights are trusted.
 *
 * Both used to be silent assumptions, and both fail in the direction that
 * writes wrong data rather than complaining:
 *
 *  - the time reference defaulted to UTC when the "All times in …" line was
 *    missing, and eCrew issues the same report in three frames that differ
 *    only by that line, so a Local Base report read as UTC puts every time in
 *    the file eight hours out — as `update_safe`, applied without review;
 *  - nothing checked WHOSE roster it was, so importing a colleague's PDF wrote
 *    their flights into this pilot's logbook as ordinary creates.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  userDb: { flights: { toArray: vi.fn(async () => []) } },
  isLiveFlight: () => true,
  getAirportByIata: vi.fn(async () => ({
    tz: "Asia/Singapore",
    icao: "WSSS",
    iata: "SIN",
  })),
  getAirportTimeInfo: vi.fn(() => ({ offset: 8 })),
  getAllPersonnel: vi.fn(async () => []),
  getCurrentUserPersonnel: vi.fn(async () => ({
    id: "self",
    name: "Lim Chin Yang",
    crewId: "9766",
    createdAt: 0,
    syncStatus: "pending",
  })),
  getUserPreferences: vi.fn(async () => null),
  DEFAULT_IMPORT_DEFAULTS: { nonPicPfRole: "PICUS" },
}));

vi.mock("@/lib/utils/parsers/shared/airport-enricher", () => ({
  enrichAirportBatch: vi.fn(async () => ({
    enriched: new Map(),
    failedCodes: [],
    stats: { localHits: 0, serverBatchHits: 0, fr24Hits: 0, failed: 0 },
  })),
}));

import { parseScheduleCSV } from "../schedule-parser";
import { extractCsvRows } from "../extractors/csv.extractor";
import type { NormalizedDocument } from "../types";

/** A minimal but structurally real schedule CSV. */
function makeCsv({
  timeLine = "Scoot Pte Ltd Personal Crew Schedule Report 01/01/2026 - 31/01/2026 (All times in UTC)",
  crewLine = "9766 Lim Chin Yang SIN-FO-32N",
}: { timeLine?: string; crewLine?: string } = {}): NormalizedDocument {
  const rawText = [
    timeLine,
    crewLine,
    "Schedule Details",
    "Date,Duties,Details,Report times,Actual times/Delays,Debrief times,Indicators,Crew",
    "01/01/2026 Thu,236 [320],SIN - BKK,06:40,A07:35 - A10:06,13:36,,FO - 9766 - Lim Chin Yang",
    '"Generated on  Aug 12, 2026 17:44"',
  ].join("\n");
  const { rows } = extractCsvRows(rawText);
  return { format: "csv", reportType: "schedule", rows, rawText, fileName: "s.csv" };
}

describe("schedule report — time reference must be stated", () => {
  it("parses normally when the header states it", async () => {
    const plan = await parseScheduleCSV(makeCsv());
    expect(plan.errors).toHaveLength(0);
    expect(plan.timeReference).toBe("UTC");
  });

  it("refuses the import when the header line is absent", async () => {
    // Not a warning: reading a Local Base report as UTC is a whole-file,
    // hours-wide error that lands as an auto-applied safe update.
    const plan = await parseScheduleCSV(
      makeCsv({
        timeLine: "Scoot Pte Ltd Personal Crew Schedule Report 01/01/2026 - 31/01/2026",
      })
    );
    expect(plan.success).toBe(false);
    expect(plan.errors[0].message).toMatch(/time reference/i);
    expect(plan.operations).toHaveLength(0);
  });

  it("reads Local Base and Local Station when stated", async () => {
    const base = await parseScheduleCSV(
      makeCsv({
        timeLine:
          "Personal Crew Schedule Report 01/01/2026 - 31/01/2026 (All times in Local Base)",
      })
    );
    expect(base.timeReference).toBe("LOCAL_BASE");

    const station = await parseScheduleCSV(
      makeCsv({
        timeLine:
          "Personal Crew Schedule Report 01/01/2026 - 31/01/2026 (All times in Local Station)",
      })
    );
    expect(station.timeReference).toBe("LOCAL_STATION");
  });
});

describe("schedule report — must belong to the logged-in pilot", () => {
  it("imports the pilot's own report", async () => {
    const plan = await parseScheduleCSV(makeCsv());
    expect(plan.errors).toHaveLength(0);
    expect(plan.crewMember.crewId).toBe("9766");
  });

  it("refuses a colleague's report outright", async () => {
    const plan = await parseScheduleCSV(
      makeCsv({ crewLine: "2727 Yu Shuqing SIN-CPT-32N" })
    );
    expect(plan.success).toBe(false);
    expect(plan.errors[0].message).toMatch(/belongs to crew 2727/i);
    expect(plan.operations).toHaveLength(0);
  });

  it("proceeds when the report names no crew id", async () => {
    // An unknown is not a mismatch — refusing here would break the import for
    // any report whose header line doesn't parse.
    const plan = await parseScheduleCSV(
      makeCsv({ crewLine: "Schedule for the month" })
    );
    expect(plan.errors.filter((e) => /belongs to crew/i.test(e.message))).toHaveLength(0);
  });
});
