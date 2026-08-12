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

// Both enrichers reach the network and, through the submission helper, the
// sync engine at module scope — the established stub for any test that touches
// a parser's orchestration layer.
vi.mock("@/lib/utils/parsers/shared/airport-enricher", () => ({
  enrichAirportBatch: vi.fn(async () => ({
    enriched: new Map(),
    failedCodes: [],
    stats: { localHits: 0, serverBatchHits: 0, fr24Hits: 0, failed: 0 },
  })),
}));

const enrichAircraftBatch = vi.fn(async (regs: string[]) => ({
  // The chain knows nothing by default; individual tests re-point it.
  enriched: new Map<string, { typecode: string }>(),
  failedRegs: regs,
  stats: { localHits: 0, serverBatchHits: 0, fr24Hits: 0, failed: regs.length },
}));
vi.mock("@/lib/utils/parsers/shared/aircraft-enricher", () => ({
  enrichAircraftBatch: (regs: string[]) => enrichAircraftBatch(regs),
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

  // ============================================================
  // The aircraft loop
  // ============================================================

  it("types a flight from the lookup chain when the file has no type", async () => {
    // Scenario A: the pilot imports the Flights tab on its own, and LogTen
    // never recorded a type for the tail. The shared enrichment chain — the
    // same one the schedule and crew-logbook imports use — answers for it.
    enrichAircraftBatch.mockResolvedValueOnce({
      enriched: new Map([["9V-NCI", { typecode: "A21N" }]]),
      failedRegs: [],
      stats: { localHits: 1, serverBatchHits: 0, fr24Hits: 0, failed: 0 },
    });

    const doc = fixture("flights.txt");
    // Blank out the flight rows' own type columns, leaving only the tail.
    const typeCol = doc.rows[0].cells.findIndex((c) => c.trim() === "aircraftType_type");
    for (const row of doc.rows.slice(1)) row.cells[typeCol] = "";

    const plan = await parseLogtenExport([doc]);
    const tr118 = plan.flights.operations.find(
      (op) => op.kind === "create" && op.flight.flightNumber === "TR118"
    );
    if (tr118?.kind !== "create") throw new Error("expected create");
    expect(tr118.flight.aircraftType).toBe("A21N");
    expect(plan.flights.untypedRegistrations).toHaveLength(0);
  });

  it("reports a tail nothing could type, rather than failing the import", async () => {
    // Same scenario, but no source knows the tail. The flight still imports;
    // the registration is listed so the Aircraft export can back-tag it later.
    const doc = fixture("flights.txt");
    const typeCol = doc.rows[0].cells.findIndex((c) => c.trim() === "aircraftType_type");
    for (const row of doc.rows.slice(1)) row.cells[typeCol] = "";

    const plan = await parseLogtenExport([doc]);
    const tr118 = plan.flights.operations.find(
      (op) => op.kind === "create" && op.flight.flightNumber === "TR118"
    );
    if (tr118?.kind !== "create") throw new Error("expected create");
    expect(tr118.flight.aircraftType).toBe("");
    expect(tr118.flight.aircraftReg).toBe("9V-NCI");
    expect(plan.flights.untypedRegistrations).toContain("9V-NCI");
    expect(plan.success).toBe(true);
    expect(plan.warnings.some((w) => /Aircraft export/i.test(w.message))).toBe(
      true
    );
  });

  it("takes the canonical registration and type from a resolved lookup", async () => {
    // LogTen holds the tail unpunctuated and paired with a stale type. The
    // chain knows that mark is an A388 registered "9V-SKU", and a flight card
    // showing "9VSKU, A21N" beside an aircraft list showing "9V-SKU, A388"
    // reads as two different aeroplanes.
    enrichAircraftBatch.mockResolvedValueOnce({
      enriched: new Map([
        ["9VSKU", { registration: "9V-SKU", typecode: "A388" }],
      ]),
      failedRegs: [],
      stats: { localHits: 0, serverBatchHits: 0, fr24Hits: 1, failed: 0 },
    });

    const doc = fixture("aircraft.txt");
    doc.rows[1].cells[0] = "9VSKU";

    const plan = await parseLogtenExport([doc]);
    const sku = plan.aircraft.toCreate.find((r) =>
      r.aircraft.registration.startsWith("9V-SKU")
    )!;
    expect(sku.aircraft.registration).toBe("9V-SKU");
    expect(sku.aircraft.typeDesignator).toBe("A388");
  });

  it("canonicalises a flight's registration to the resolved spelling", async () => {
    enrichAircraftBatch.mockResolvedValueOnce({
      enriched: new Map([
        ["9VNCI", { registration: "9V-NCI", typecode: "A21N" }],
      ]),
      failedRegs: [],
      stats: { localHits: 1, serverBatchHits: 0, fr24Hits: 0, failed: 0 },
    });

    const doc = fixture("flights.txt");
    const regCol = doc.rows[0].cells.findIndex(
      (c) => c.trim() === "aircraft_aircraftID"
    );
    // Every permutation a LogTen user might have typed means the same tail.
    doc.rows[2].cells[regCol] = "9vnci";
    doc.rows[3].cells[regCol] = "9V NCI";

    const plan = await parseLogtenExport([doc]);
    const creates = plan.flights.operations.filter((op) => op.kind === "create");
    for (const op of creates) {
      if (op.kind !== "create" || !op.flight.aircraftReg) continue;
      expect(op.flight.aircraftReg).toBe("9V-NCI");
    }
  });

  it("keeps the file's type when the pilot asks it to", async () => {
    // The escape hatch for a career containing a re-issued registration: the
    // lookup describes the airframe flying under that mark TODAY, not the one
    // logged in 2011. The canonical SPELLING still follows the lookup — that
    // is punctuation, not a claim about the aeroplane.
    enrichAircraftBatch.mockResolvedValueOnce({
      enriched: new Map([
        ["9V-NCI", { registration: "9V-NCI", typecode: "B78X" }],
      ]),
      failedRegs: [],
      stats: { localHits: 1, serverBatchHits: 0, fr24Hits: 0, failed: 0 },
    });

    const plan = await parseLogtenExport([fixture("flights.txt")], {
      preferFileType: true,
    });
    const tr118 = plan.flights.operations.find(
      (op) => op.kind === "create" && op.flight.flightNumber === "TR118"
    );
    if (tr118?.kind !== "create") throw new Error("expected create");
    expect(tr118.flight.aircraftType).toBe("A21N");
    expect(tr118.flight.aircraftReg).toBe("9V-NCI");
  });

  it("writes 'Self' for the seat the logged-in pilot occupied", async () => {
    // The app's convention, written by `deriveSectorCrew` on every eCrew
    // import and rendered verbatim on the flight card. A migrated row carrying
    // the pilot's own name instead read as though somebody else was in the seat.
    const plan = await parseLogtenExport(ALL_THREE(), { skipEnrichment: true });
    const tr118 = plan.flights.operations.find(
      (op) => op.kind === "create" && op.flight.flightNumber === "TR118"
    );
    if (tr118?.kind !== "create") throw new Error("expected create");
    expect(tr118.flight.sicName).toBe("Self");
    expect(tr118.flight.sicId).toBe("self");
    // …and the other seat keeps its real name.
    expect(tr118.flight.picName).toBe("Tan Wei Ming");
  });

  it("flags an unresolvable tail so the executor seeds it locally", async () => {
    // Scenario B: the Aircraft export arrives first and the chain can't type
    // some tails. They import wholesale from the file, and get written into the
    // reference DB so a later flight import resolves them without the network.
    const plan = await parseLogtenExport([fixture("aircraft.txt")]);
    expect(plan.aircraft.unresolvedRegistrations).toEqual(
      expect.arrayContaining(["9V-NCE", "9V-NCI", "9V-TNA"])
    );
    // …and they still carry the file's own type.
    const nci = plan.aircraft.toCreate.find(
      (r) => r.aircraft.registration === "9V-NCI"
    )!;
    expect(nci.aircraft.typeDesignator).toBe("A21N");
  });

  it("carries LogTen's own aircraft detail across", async () => {
    const doc = fixture("aircraft.txt");
    const header = doc.rows[0].cells;
    const serialCol = header.findIndex((c) => c.trim() === "Serial Number");
    const notesCol = header.indexOf("Notes"); // the aircraft's, not the type's
    const operatorCol = header.findIndex((c) => c.trim() === "Operator");
    doc.rows[1].cells[serialCol] = "8412";
    doc.rows[1].cells[notesCol] = "Cabin mod Jan 26";
    doc.rows[1].cells[operatorCol] = "Scoot";

    const plan = await parseLogtenExport([doc]);
    const nce = plan.aircraft.toCreate.find(
      (r) => r.aircraft.registration === "9V-NCE"
    )!;
    expect(nce.aircraft.serialNumber).toBe("8412");
    expect(nce.aircraft.notes).toBe("Cabin mod Jan 26");
    expect(nce.aircraft.operator).toBe("Scoot");
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
