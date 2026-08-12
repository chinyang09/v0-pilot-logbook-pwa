/**
 * The three LogTen Pro parsers, run against the REAL export files.
 *
 * The fixtures in `fixtures/` are exports from LogTen Pro (a Scoot A320-family
 * pilot's account), which is what makes these tests worth having: they pin the
 * dirty parts of the actual format — the tab separator, the columns padded
 * with a leading space, LogTen's "New" placeholder aircraft, the ~280-column
 * flights table where addressing anything by index would be a guess — rather
 * than a tidied-up idea of it.
 *
 * Only the crew NAMES and employee ids were substituted, so no colleague's
 * details live in the repo. Every structural quirk is byte-for-byte intact,
 * including the zero-padded id form and the leading spaces.
 *
 * `@/lib/db` is stubbed because the shared crew resolver and the airport
 * enricher both reach for IndexedDB at module scope. Same stub set as
 * `pdf-schedule-merge.test.ts`.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/db", () => ({
  userDb: { flights: { toArray: vi.fn(async () => []) } },
  isLiveFlight: (f: { deletedAt?: number }) => f.deletedAt == null,
  getAirportByIata: vi.fn(async () => null),
  getAirportByIcao: vi.fn(async () => null),
  getAirportTimeInfo: vi.fn(() => ({ offset: 8 })),
  getAllPersonnel: vi.fn(async () => []),
  getAllAircraft: vi.fn(async () => []),
  getAircraftType: vi.fn(async () => null),
  getCurrentUserPersonnel: vi.fn(async () => null),
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

import { extractCsvRows } from "../../extractors/csv.extractor";
import { detectReportType } from "../../detect";
import { parseLogtenAddressBook } from "../address-book";
import { parseLogtenAircraft } from "../aircraft";
import { parseLogtenFlights } from "../flights";
import type { NormalizedDocument } from "../../types";
import type { Personnel } from "@/types/entities/crew.types";
import type { FlightLog } from "@/types/entities/flight.types";
import type { Airport } from "@/types/entities/airport.types";

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

const SELF: Personnel = {
  id: "self",
  name: "Lim Chin Yang",
  crewId: "1234",
  organization: "Scoot",
  roles: ["SIC"],
  isMe: true,
  createdAt: 0,
  syncStatus: "pending",
};

function airport(icao: string, iata: string, tz: string): Airport {
  return {
    icao,
    iata,
    name: icao,
    city: "",
    country: "",
    latitude: 1.35,
    longitude: 103.99,
    elevation: 0,
    tz,
  } as Airport;
}

// WSSS and ZJHK are both UTC+8, which is exactly why the sample file cannot
// settle the time reference on its own — see the detection test below.
const AIRPORTS = new Map<string, Airport>([
  ["WSSS", airport("WSSS", "SIN", "Asia/Singapore")],
  ["ZJHK", airport("ZJHK", "HAK", "Asia/Shanghai")],
]);
const OFFSETS = new Map<string, number>([
  ["WSSS", 8],
  ["ZJHK", 8],
]);

// ============================================================
// Detection + delimiter
// ============================================================

describe("detection", () => {
  it("tells the three LogTen exports apart by their header alone", () => {
    expect(fixture("flights.txt").reportType).toBe("logten_flights");
    expect(fixture("aircraft.txt").reportType).toBe("logten_aircraft");
    expect(fixture("address-book.txt").reportType).toBe("logten_crew");
  });

  it("splits on tabs, so a 280-column flights row stays one row", () => {
    const doc = fixture("flights.txt");
    expect(doc.delimiter).toBe("\t");
    expect(doc.rows[0].cells).toHaveLength(280);
    // Header + 3 data rows; the file's trailing blank line is dropped.
    expect(doc.rows).toHaveLength(4);
  });

  it("leaves an eCrew comma CSV on the comma", () => {
    const { delimiter, rows } = extractCsvRows(
      "Date,Airport,Time,Airport,Time\n01/04/26,SIN,0449,BKK,0722\n"
    );
    expect(delimiter).toBe(",");
    expect(rows[1].cells).toEqual(["01/04/26", "SIN", "0449", "BKK", "0722"]);
  });
});

// ============================================================
// Address book
// ============================================================

describe("parseLogtenAddressBook", () => {
  it("maps the three contacts, reading the space-padded columns", () => {
    const plan = parseLogtenAddressBook(fixture("address-book.txt"), {
      existingPersonnel: [],
      currentUser: SELF,
    });

    const names = plan.toCreate.map((r) => r.personnel.name);
    expect(names).toContain("RAJENDRAN A/L SUBRAMANIAM PILLAI");
    expect(names).toContain("Tan Wei Ming");

    const tan = plan.toCreate.find((r) => r.personnel.name === "Tan Wei Ming")!;
    expect(tan.personnel.organization).toBe("Scoot");
    // " PIC" — the value arrives with LogTen's leading space.
    expect(tan.personnel.roles).toEqual(["PIC"]);
  });

  it("strips LogTen's zero padding off a numeric crew id", () => {
    const plan = parseLogtenAddressBook(fixture("address-book.txt"), {
      existingPersonnel: [],
      currentUser: SELF,
    });
    const padded = plan.toCreate.find((r) =>
      r.personnel.name.startsWith("RAJENDRAN")
    )!;
    // "0004321" in the file — the app's crew ids are compared as plain
    // strings, so a padded copy would never match the eCrew reports'.
    expect(padded.personnel.crewId).toBe("4321");
  });

  it("never creates a second 'this is me' — it merges into the existing self", () => {
    const plan = parseLogtenAddressBook(fixture("address-book.txt"), {
      existingPersonnel: [SELF],
      currentUser: SELF,
    });
    expect(plan.toCreate.some((r) => r.personnel.isMe)).toBe(false);
    expect(
      plan.toCreate.some((r) => r.personnel.name === "Lim Chin Yang")
    ).toBe(false);
  });

  it("does honour the flag when the app has no profile at all", () => {
    const plan = parseLogtenAddressBook(fixture("address-book.txt"), {
      existingPersonnel: [],
      currentUser: null,
    });
    const me = plan.toCreate.find((r) => r.personnel.name === "Lim Chin Yang");
    expect(me?.personnel.isMe).toBe(true);
  });

  it("backfills an existing contact instead of duplicating them", () => {
    const existing: Personnel = {
      id: "tan",
      name: "Tan Wei Ming",
      createdAt: 0,
      syncStatus: "pending",
    };
    const plan = parseLogtenAddressBook(fixture("address-book.txt"), {
      existingPersonnel: [existing],
      currentUser: SELF,
    });
    expect(plan.toCreate.some((r) => r.personnel.name === "Tan Wei Ming")).toBe(
      false
    );
    const update = plan.toUpdate.find((r) => r.matchedPersonnelId === "tan")!;
    expect(update.patch).toMatchObject({
      crewId: "7714",
      organization: "Scoot",
      roles: ["PIC"],
    });
  });
});

// ============================================================
// Aircraft
// ============================================================

describe("parseLogtenAircraft", () => {
  it("maps the fleet and folds Engine Type + Class into the app's enum", () => {
    const plan = parseLogtenAircraft(fixture("aircraft.txt"), {
      existingAircraft: [],
    });

    const regs = plan.toCreate.map((r) => r.aircraft.registration);
    expect(regs).toEqual(["9V-NCE", "9V-NCI", "9V-TNA", "9V-TNB", "9V-TNC"]);

    const nce = plan.toCreate[0].aircraft;
    expect(nce.typeDesignator).toBe("A21N");
    expect(nce.model).toBe("AIRBUS INDUSTRIES (International) A-321neo");
    // "Jet" + "Multi-Engine Land" → JET, the same value an eCrew import lands
    // on, so the dashboard's by-engine ring counts them together.
    expect(nce.engineType).toBe("JET");
    expect(nce.category).toBe("Airplane");
  });

  it("skips LogTen's 'New' placeholder rows rather than importing them", () => {
    const plan = parseLogtenAircraft(fixture("aircraft.txt"), {
      existingAircraft: [],
    });
    expect(
      plan.toCreate.some((r) => r.aircraft.registration === "NEW")
    ).toBe(false);
    // Both placeholders are reported, not silently dropped.
    expect(plan.skipped).toHaveLength(2);
  });

  it("publishes registration → type for the flight parser to fall back on", () => {
    const plan = parseLogtenAircraft(fixture("aircraft.txt"), {
      existingAircraft: [],
    });
    expect(plan.typeByRegistration.get("9VNCI")).toBe("A21N");
    expect(plan.typeByRegistration.get("9VTNA")).toBe("A20N");
  });
});

// ============================================================
// Flights
// ============================================================

function flightPlan(overrides: Parameters<typeof parseLogtenFlights>[2] = {}) {
  return parseLogtenFlights(
    fixture("flights.txt"),
    {
      currentUser: SELF,
      existingPersonnel: [SELF],
      existingFlights: [],
      airports: AIRPORTS,
      offsets: OFFSETS,
    },
    { skipEnrichment: true, ...overrides }
  );
}

describe("parseLogtenFlights", () => {
  it("maps all four OOOI times out of LogTen's four separate columns", () => {
    const plan = flightPlan();
    const tr118 = plan.operations.find(
      (op) => op.kind === "create" && op.flight.flightNumber === "TR118"
    );
    expect(tr118?.kind).toBe("create");
    if (tr118?.kind !== "create") throw new Error("expected create");

    expect(tr118.flight).toMatchObject({
      date: "2026-08-09",
      flightNumber: "TR118",
      departureIcao: "WSSS",
      arrivalIcao: "ZJHK",
      scheduledOut: "23:00",
      outTime: "23:29", // flight_actualDepartureTime
      offTime: "23:40", // flight_takeoffTime
      onTime: "02:50", // flight_landingTime
      inTime: "02:56", // flight_actualArrivalTime
      scheduledIn: "02:40",
      blockTime: "03:27", // flight_totalTime  (out → in)
      flightTime: "03:10", // flight_duration   (off → on)
      aircraftReg: "9V-NCI",
      aircraftType: "A21N",
    });
  });

  it("reads the seat from the role TIME column, not a capacity flag alone", () => {
    const plan = flightPlan();
    const creates = plan.operations.filter((op) => op.kind === "create");

    // TR118 carries flight_sic = 3:27 → SIC.
    const tr118 = creates.find(
      (op) => op.kind === "create" && op.flight.flightNumber === "TR118"
    );
    if (tr118?.kind !== "create") throw new Error("expected create");
    expect(tr118.flight.pilotRole).toBe("SIC");
    expect(tr118.flight.sicTime).toBe("03:27");
    expect(tr118.flight.picName).toBe("Tan Wei Ming");

    // TR119 carries flight_p1us = 3:18 → PICUS, and no SIC time at all.
    const tr119 = creates.find(
      (op) => op.kind === "create" && op.flight.flightNumber === "TR119"
    );
    if (tr119?.kind !== "create") throw new Error("expected create");
    expect(tr119.flight.pilotRole).toBe("PICUS");
    expect(tr119.flight.picusTime).toBe("03:18");
  });

  it("keeps the flight number verbatim, with no carrier rewriting", () => {
    // The eCrew reconciler forces numbers into the TR… house style because it
    // is reconciling one airline's roster. A migration carries a career.
    const plan = flightPlan();
    const numbers = plan.operations
      .filter((op) => op.kind === "create")
      .map((op) => (op.kind === "create" ? op.flight.flightNumber : ""));
    expect(numbers).toContain("TR118");
    expect(numbers).toContain("TR119");
  });

  it("unpacks an approach cell into typed approaches", () => {
    const plan = flightPlan();
    const tr119 = plan.operations.find(
      (op) => op.kind === "create" && op.flight.flightNumber === "TR119"
    );
    if (tr119?.kind !== "create") throw new Error("expected create");
    // "1;ILS;20R;WSSS"
    expect(tr119.flight.approaches).toHaveLength(1);
    expect(tr119.flight.approaches[0]).toMatchObject({
      type: "ILS",
      category: "precision",
      runway: "20R",
      airport: "WSSS",
    });
  });

  it("recognises the simulator structurally and keeps it out of block time", () => {
    const plan = flightPlan();
    const sim = plan.operations.find(
      (op) => op.kind === "create" && op.flight.entryType === "simulator"
    );
    if (sim?.kind !== "create") throw new Error("expected a simulator create");

    // The row has no aircraft and no `to` airport. LogTen's own
    // flight_simulator column is EMPTY on it, which is why the test is worth
    // having — keying on that column would have missed this session.
    expect(sim.flight.date).toBe("2026-05-13");
    expect(sim.flight.isSimulator).toBe(true);
    expect(sim.flight.simulatedInstrumentTime).toBe("04:00");
    expect(sim.flight.blockTime).toBe("00:00");
    expect(sim.flight.aircraftReg).toBe("");
  });

  it("pins the pilot's own figures as manual overrides", () => {
    const plan = flightPlan();
    const tr118 = plan.operations.find(
      (op) => op.kind === "create" && op.flight.flightNumber === "TR118"
    );
    if (tr118?.kind !== "create") throw new Error("expected create");

    // flight_sic is populated, so the role times are the pilot's record and
    // recalculateFlightFields must not restate them.
    expect(tr118.flight.manualOverrides.sicTime).toBe(true);
    expect(tr118.flight.manualOverrides.picTime).toBe(true);
    // flight_night is blank in this export — left for the app to compute.
    expect(tr118.flight.manualOverrides.nightTime).toBeUndefined();
    // Day landings/takeoffs ARE recorded, so they are pinned.
    expect(tr118.flight.manualOverrides.dayLandings).toBe(true);
    expect(tr118.flight.dayLandings).toBe(1);
  });

  it("can be told not to pin anything", () => {
    const plan = flightPlan({ preserveSourceValues: false });
    const tr118 = plan.operations.find(
      (op) => op.kind === "create" && op.flight.flightNumber === "TR118"
    );
    if (tr118?.kind !== "create") throw new Error("expected create");
    expect(tr118.flight.manualOverrides).toEqual({});
  });

  it("resolves crew names against the people already known", () => {
    const tan: Personnel = {
      id: "tan",
      name: "Tan Wei Ming",
      createdAt: 0,
      syncStatus: "pending",
    };
    const plan = parseLogtenFlights(
      fixture("flights.txt"),
      {
        currentUser: SELF,
        existingPersonnel: [SELF, tan],
        existingFlights: [],
        airports: AIRPORTS,
        offsets: OFFSETS,
      },
      { skipEnrichment: true }
    );
    const tr118 = plan.operations.find(
      (op) => op.kind === "create" && op.flight.flightNumber === "TR118"
    );
    if (tr118?.kind !== "create") throw new Error("expected create");
    expect(tr118.flight.picId).toBe("tan");
    // The pilot themselves is the SIC on this leg.
    expect(tr118.flight.sicId).toBe("self");
    expect(plan.personnelToCreate).toHaveLength(0);
  });

  it("converts local station times to UTC, moving the date when it wraps", () => {
    const plan = flightPlan({ timeReference: "local", skipEnrichment: true });
    const creates = plan.operations.filter((op) => op.kind === "create");

    // TR118: 23:29 local at UTC+8 → 15:29 UTC, same day.
    const tr118 = creates.find(
      (op) => op.kind === "create" && op.flight.flightNumber === "TR118"
    );
    if (tr118?.kind !== "create") throw new Error("expected create");
    expect(tr118.flight.date).toBe("2026-08-09");
    expect(tr118.flight.outTime).toBe("15:29");
    expect(tr118.flight.offTime).toBe("15:40");
    expect(tr118.flight.onTime).toBe("18:50");
    expect(tr118.flight.inTime).toBe("18:56");

    // TR119: 04:02 local at UTC+8 → 20:02 UTC on the PREVIOUS day, so the
    // flight's own date moves with its out time.
    const tr119 = creates.find(
      (op) => op.kind === "create" && op.flight.flightNumber === "TR119"
    );
    if (tr119?.kind !== "create") throw new Error("expected create");
    expect(tr119.flight.date).toBe("2026-08-09");
    expect(tr119.flight.outTime).toBe("20:02");

    expect(plan.timeReference).toBe("local");
    expect(plan.timeReferenceConfidence).toBe("forced");
  });

  it("warns that the reference was assumed when the file cannot settle it", () => {
    // Every sector in this export is inside UTC+8, so nothing in the file
    // distinguishes UTC from local — the pilot has to be told.
    const plan = flightPlan();
    expect(plan.timeReferenceConfidence).toBe("assumed");
    expect(plan.warnings.some((w) => /local/i.test(w.message))).toBe(true);
  });

  it("reports a row with no readable date instead of crashing", () => {
    const doc = fixture("flights.txt");
    // A row of the right width whose date cell is junk.
    const corrupt = new Array(280).fill("");
    corrupt[0] = "Totals";
    corrupt[2] = "TR999";
    doc.rows.push({ index: doc.rows.length, raw: corrupt.join("\t"), cells: corrupt });

    const plan = parseLogtenFlights(
      doc,
      {
        currentUser: SELF,
        existingPersonnel: [SELF],
        existingFlights: [],
        airports: AIRPORTS,
        offsets: OFFSETS,
      },
      { skipEnrichment: true }
    );

    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0].message).toMatch(/flight date/i);
    // The three good rows still import.
    expect(plan.operations).toHaveLength(3);
    expect(plan.errors).toHaveLength(0);
  });

  it("survives a truncated row that stops mid-table", () => {
    const doc = fixture("flights.txt");
    doc.rows.push({
      index: doc.rows.length,
      raw: "2026-08-11\t\tTR200\tWSSS\tZJHK",
      cells: ["2026-08-11", "", "TR200", "WSSS", "ZJHK"],
    });

    const plan = parseLogtenFlights(
      doc,
      {
        currentUser: SELF,
        existingPersonnel: [SELF],
        existingFlights: [],
        airports: AIRPORTS,
        offsets: OFFSETS,
      },
      { skipEnrichment: true }
    );

    expect(plan.errors).toHaveLength(0);
    const short = plan.operations.find(
      (op) => op.kind === "create" && op.flight.flightNumber === "TR200"
    );
    if (short?.kind !== "create") throw new Error("expected create");
    expect(short.flight.blockTime).toBe("00:00");
    expect(short.flight.outTime).toBe("");
  });
});

// ============================================================
// Duplicate detection
// ============================================================

describe("duplicate detection", () => {
  const existingTr118 = {
    id: "existing",
    date: "2026-08-09",
    flightNumber: "TR118",
    departureIcao: "WSSS",
    departureIata: "SIN",
    arrivalIcao: "ZJHK",
    arrivalIata: "HAK",
    outTime: "23:29",
    inTime: "02:56",
    blockTime: "03:27",
    remarks: "",
    approaches: [],
    additionalCrew: [],
    picId: "",
    sicId: "",
    picName: "",
    sicName: "",
    offTime: "",
    onTime: "",
    createdAt: 0,
    syncStatus: "pending" as const,
  };

  function planAgainst(existing: unknown[]) {
    return parseLogtenFlights(
      fixture("flights.txt"),
      {
        currentUser: SELF,
        existingPersonnel: [SELF],
        existingFlights: existing as FlightLog[],
        airports: AIRPORTS,
        offsets: OFFSETS,
      },
      { skipEnrichment: true }
    );
  }

  it("fills the blanks on a flight already in the logbook", () => {
    const plan = planAgainst([existingTr118]);
    const op = plan.operations.find((o) => o.sourceLine === 3)!;
    expect(op.kind).toBe("update_fill");
    if (op.kind !== "update_fill") throw new Error("expected update_fill");
    // The hand-entered flight has no takeoff/landing times or crew.
    expect(op.filledFields).toContain("offTime");
    expect(op.filledFields).toContain("onTime");
    expect(op.filledFields).toContain("picName");
    // …and nothing it already had is in the patch.
    expect(op.patch.outTime).toBeUndefined();
    expect(op.patch.blockTime).toBeUndefined();
  });

  it("leaves an already-complete flight completely alone", () => {
    const complete = {
      ...existingTr118,
      offTime: "23:40",
      onTime: "02:50",
      flightTime: "03:10",
      picName: "Tan Wei Ming",
      sicName: "Lim Chin Yang",
      picId: "tan",
      sicId: "self",
      sicTime: "03:27",
      scheduledOut: "23:00",
      scheduledIn: "02:40",
      aircraftReg: "9V-NCI",
      aircraftType: "A21N",
      remarks: "",
    };
    const plan = planAgainst([complete]);
    const op = plan.operations.find((o) => o.sourceLine === 3)!;
    expect(op.kind).toBe("skip_duplicate");
  });

  it("does not confuse two different sectors on the same day", () => {
    // TR119 is the return leg — same day range, opposite route.
    const plan = planAgainst([existingTr118]);
    const tr119 = plan.operations.find((o) => o.sourceLine === 4)!;
    expect(tr119.kind).toBe("create");
  });
});
