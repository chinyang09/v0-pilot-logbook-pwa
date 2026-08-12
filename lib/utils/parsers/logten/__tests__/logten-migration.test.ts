/**
 * The whole migration, all three files at once.
 *
 * The three exports are cross-dependent and that is the part worth pinning:
 * the Address Book supplies the people a flight row's PIC column names, and
 * the Aircraft export supplies the type for a registration whose flight row
 * left its own type columns blank. Parsing them in isolation passes; parsing
 * them together is where "Tan Wei Ming" either resolves to the contact about
 * to be created or becomes a second copy of him.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SELF = {
  id: "self",
  name: "Lim Chin Yang",
  crewId: "1234",
  organization: "Scoot",
  roles: ["SIC"] as const,
  isMe: true,
  createdAt: 0,
  syncStatus: "pending" as const,
};

vi.mock("@/lib/db", () => ({
  userDb: { flights: { toArray: vi.fn(async () => []) } },
  isLiveFlight: (f: { deletedAt?: number }) => f.deletedAt == null,
  getAirportByIata: vi.fn(async () => null),
  getAirportByIcao: vi.fn(async () => null),
  getAirportTimeInfo: vi.fn(() => ({ offset: 8 })),
  getAllPersonnel: vi.fn(async () => []),
  getAllAircraft: vi.fn(async () => []),
  getAircraftType: vi.fn(async () => null),
  getCurrentUserPersonnel: vi.fn(async () => SELF),
  addFlight: vi.fn(),
  addAircraft: vi.fn(),
  addPersonnel: vi.fn(),
  updateFlight: vi.fn(),
  updateAircraft: vi.fn(),
  updatePersonnel: vi.fn(),
}));

vi.mock("@/lib/db/stores/reference/airports.store", () => ({
  getAirportByIcao: vi.fn(async () => undefined),
  getAirportByIata: vi.fn(async () => undefined),
  addCustomAirport: vi.fn(async () => undefined),
}));

// The airport enricher reaches the network and, through the submission
// helper, the sync engine at module scope — the established stub for any test
// that touches a parser's orchestration layer.
vi.mock("@/lib/utils/parsers/shared/airport-enricher", () => ({
  enrichAirportBatch: vi.fn(async () => ({
    enriched: new Map(),
    failedCodes: [],
    stats: { localHits: 0, serverBatchHits: 0, fr24Hits: 0, failed: 0 },
  })),
}));

import { extractCsvRows } from "../../extractors/csv.extractor";
import { detectReportType } from "../../detect";
import { parseLogtenExport } from "../index";
import type { NormalizedDocument } from "../../types";

function fixture(name: string): NormalizedDocument {
  const rawText = readFileSync(join(__dirname, "fixtures", name), "utf8");
  const { rows, delimiter } = extractCsvRows(rawText);
  return {
    format: "csv",
    reportType: detectReportType(rawText),
    rows,
    rawText,
    fileName: name,
    delimiter,
  };
}

const ALL_THREE = () => [
  fixture("flights.txt"),
  fixture("aircraft.txt"),
  fixture("address-book.txt"),
];

describe("parseLogtenExport", () => {
  it("plans all three files in one pass", async () => {
    const plan = await parseLogtenExport(ALL_THREE(), { skipEnrichment: true });

    expect(plan.success).toBe(true);
    expect(plan.sources).toEqual({
      flights: "flights.txt",
      aircraft: "aircraft.txt",
      crew: "address-book.txt",
    });
    expect(plan.summary).toMatchObject({
      flightsToCreate: 2, // TR118 + TR119
      simulatorsToCreate: 1,
      flightsDuplicate: 0,
      aircraftToCreate: 5, // the two "New" placeholders are skipped
      crewToCreate: 2, // the self row merges rather than being added
    });
  });

  it("resolves a flight's PIC to the contact the address book brings", async () => {
    const plan = await parseLogtenExport(ALL_THREE(), { skipEnrichment: true });

    const tan = plan.crew.toCreate.find(
      (r) => r.personnel.name === "Tan Wei Ming"
    );
    expect(tan).toBeDefined();

    const tr118 = plan.flights.operations.find(
      (op) => op.kind === "create" && op.flight.flightNumber === "TR118"
    );
    if (tr118?.kind !== "create") throw new Error("expected create");

    // The same id — not a second Tan Wei Ming invented by the flight parser.
    expect(tr118.flight.picId).toBe(tan!.personnel.id);
    expect(plan.flights.personnelToCreate).toHaveLength(0);
  });

  it("works with the flights file on its own", async () => {
    const plan = await parseLogtenExport([fixture("flights.txt")], {
      skipEnrichment: true,
    });
    expect(plan.success).toBe(true);
    expect(plan.summary.flightsToCreate).toBe(2);
    // Nobody was pre-seeded, so the PIC has to be created from the flight row.
    expect(
      plan.flights.personnelToCreate.some((p) => p.name === "Tan Wei Ming")
    ).toBe(true);
  });

  it("works with the aircraft file on its own", async () => {
    const plan = await parseLogtenExport([fixture("aircraft.txt")], {
      skipEnrichment: true,
    });
    expect(plan.success).toBe(true);
    expect(plan.summary.aircraftToCreate).toBe(5);
    expect(plan.summary.flightsToCreate).toBe(0);
  });

  it("rejects a file that isn't a LogTen export", async () => {
    const plan = await parseLogtenExport([], { skipEnrichment: true });
    expect(plan.success).toBe(false);
    expect(plan.errors[0].message).toMatch(/No LogTen Pro export/i);
  });

  it("collects every issue the three parsers raised", async () => {
    const plan = await parseLogtenExport(ALL_THREE(), { skipEnrichment: true });
    // Two "New" placeholder aircraft, and the self row that merged instead of
    // being created.
    expect(plan.summary.rowsSkipped).toBeGreaterThanOrEqual(3);
    // The single-timezone file can't settle UTC vs local, so it must say so.
    expect(plan.warnings.some((w) => /local/i.test(w.message))).toBe(true);
  });
});
