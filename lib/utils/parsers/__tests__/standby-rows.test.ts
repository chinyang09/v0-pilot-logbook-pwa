/**
 * Standby / ground duty rows through the schedule parser.
 *
 * These rows used to be dropped outright: a non-flight row was offered to
 * `tryExtractSimDuty`, which returns null for anything that is not a
 * simulator, and was then skipped. Standby was therefore invisible to the app
 * however many reports were imported — so neither the rest before a standby
 * nor its contribution to the cumulative duty limits of para 12 could be
 * checked.
 *
 * The times matter as much as the rows. eCrew issues the same report in three
 * frames that differ only by one header line, so a standby window read in the
 * wrong frame is hours out — and converting it can move the DATE, which is
 * what the app keys a duty on.
 */

import { describe, it, expect, vi } from "vitest";
import type { NormalizedDocument, NormalizedRow } from "../types";

vi.mock("@/lib/db", () => ({
  userDb: { flights: { toArray: vi.fn(async () => []) } },
  isLiveFlight: () => true,
  getAirportByIata: vi.fn(async (iata: string) =>
    iata?.toUpperCase() === "SIN" ? { tz: "Asia/Singapore", icao: "WSSS" } : null,
  ),
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

function row(y: number, cells: (string | undefined)[]): NormalizedRow {
  const filled = new Array(8).fill("");
  for (let i = 0; i < cells.length && i < 8; i++) {
    if (cells[i] !== undefined) filled[i] = cells[i]!;
  }
  return { index: 0, raw: filled.join(","), cells: filled, y };
}

/** A one-page report holding a single standby day. */
function buildStandbyDoc(frameLabel: string, window: string): NormalizedDocument {
  const rows: NormalizedRow[] = [
    row(559, ["Scoot Pte Ltd"]),
    row(531, ["", "", "", `01/06/2026 - 30/06/2026 (All times in ${frameLabel})`]),
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
    row(394, ["02/06/2026 Tue", "BKUP", "Backup Standby SIN", window, "", "", "", ""]),
    row(340, ["03/06/2026 Wed", "LOFF", "Local Day Off for Tech Crew", "", "", "", "", ""]),
  ].map((r, i) => ({ ...r, index: i }));

  return {
    format: "pdf",
    reportType: "schedule",
    rows,
    rawText: rows.map((r) => r.raw).join("\n"),
  };
}

describe("standby rows survive the parser", () => {
  it("extracts a standby and a day off that used to be dropped", async () => {
    const plan = await parseScheduleCSV(buildStandbyDoc("UTC", "06:00 - 18:00"));

    const standby = plan.groundDuties.find((d) => d.dutyType === "standby");
    expect(standby).toBeDefined();
    expect(standby!.dutyCode).toBe("BKUP");
    expect(standby!.startTime).toBe("06:00");
    expect(standby!.endTime).toBe("18:00");

    const off = plan.groundDuties.find((d) => d.dutyType === "off");
    expect(off).toBeDefined();
    // A day off is a date, not a duty window.
    expect(off!.startTime).toBeUndefined();
  });

  it("converts a Local Base window to UTC", async () => {
    const plan = await parseScheduleCSV(
      buildStandbyDoc("Local Base", "06:00 - 18:00"),
    );
    const standby = plan.groundDuties.find((d) => d.dutyType === "standby")!;
    // 06:00 SGT is 22:00 UTC the PREVIOUS day — the conversion moves the date,
    // and the app keys a duty on its UTC date.
    expect(standby.startTime).toBe("22:00");
    expect(standby.endTime).toBe("10:00");
    expect(standby.date).toBe("2026-06-01");
  });

  it("keeps the duty on its own date when the shift does not wrap", async () => {
    const plan = await parseScheduleCSV(
      buildStandbyDoc("Local Base", "14:00 - 22:00"),
    );
    const standby = plan.groundDuties.find((d) => d.dutyType === "standby")!;
    expect(standby.startTime).toBe("06:00");
    expect(standby.endTime).toBe("14:00");
    expect(standby.date).toBe("2026-06-02");
  });

  it("does not turn a standby row into a flight or a simulator", async () => {
    const plan = await parseScheduleCSV(buildStandbyDoc("UTC", "06:00 - 18:00"));
    expect(plan.operations).toHaveLength(0);
    expect(plan.simSessions).toHaveLength(0);
  });
});
