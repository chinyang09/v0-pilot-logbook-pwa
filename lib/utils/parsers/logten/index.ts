/**
 * LogTen Pro migration — the single entry point.
 *
 * A migration is up to three files, exported from LogTen's three tabs, and
 * they are cross-dependent:
 *
 *   Address Book ──▶ crew, which the flight rows' PIC/SIC names resolve against
 *   Aircraft ─────▶ the fleet, which supplies a type for any flight row whose
 *                   own type columns are blank
 *   Flights ──────▶ the logbook itself
 *
 * So they are parsed in that order and the earlier results feed the later
 * ones. Any subset is accepted: an Aircraft file on its own imports a fleet,
 * and a Flights file on its own still works — it just has to create crew and
 * infer types as it goes.
 *
 * Nothing here writes. `executeLogtenImport` applies the plan.
 */

import type { Airport } from "@/types/entities/airport.types";
import type { FlightLog } from "@/types/entities/flight.types";
import {
  getAirportTimeInfo,
  getAllAircraft,
  getAllPersonnel,
  getCurrentUserPersonnel,
  isLiveFlight,
  userDb,
} from "@/lib/db";
import { enrichAirportBatch } from "../shared/airport-enricher";
import type { NormalizedDocument } from "../types";
import { parseLogtenAddressBook } from "./address-book";
import { parseLogtenAircraft } from "./aircraft";
import {
  collectAirportCodes,
  collectRegistrations,
  parseLogtenFlights,
} from "./flights";
import type {
  LogtenAircraftPlan,
  LogtenCrewPlan,
  LogtenFlightPlan,
  LogtenImportPlan,
  LogtenParseOptions,
} from "./types";

export * from "./types";
export { parseLogtenAddressBook } from "./address-book";
export { parseLogtenAircraft } from "./aircraft";
export { parseLogtenFlights } from "./flights";
export { executeLogtenImport } from "./executor";
export type { LogtenExecutionResult } from "./executor";

const EMPTY_CREW: LogtenCrewPlan = {
  toCreate: [],
  toUpdate: [],
  skipped: [],
  warnings: [],
  errors: [],
};

const EMPTY_AIRCRAFT: LogtenAircraftPlan = {
  toCreate: [],
  toUpdate: [],
  skipped: [],
  warnings: [],
  errors: [],
  typeByRegistration: new Map(),
};

const EMPTY_FLIGHTS: LogtenFlightPlan = {
  operations: [],
  timeReference: "utc",
  timeReferenceConfidence: "assumed",
  timeReferenceEvidence: "",
  dateRange: { start: "", end: "" },
  registrations: [],
  airportCodes: [],
  unresolvedAirports: [],
  personnelToCreate: [],
  skipped: [],
  warnings: [],
  errors: [],
};

export async function parseLogtenExport(
  docs: NormalizedDocument[],
  options: LogtenParseOptions = {}
): Promise<LogtenImportPlan> {
  const { onProgress } = options;

  const plan: LogtenImportPlan = {
    success: false,
    crew: EMPTY_CREW,
    aircraft: EMPTY_AIRCRAFT,
    flights: EMPTY_FLIGHTS,
    sources: {},
    errors: [],
    warnings: [],
    summary: {
      flightsToCreate: 0,
      flightsToUpdate: 0,
      flightsDuplicate: 0,
      simulatorsToCreate: 0,
      crewToCreate: 0,
      crewToUpdate: 0,
      aircraftToCreate: 0,
      aircraftToUpdate: 0,
      rowsSkipped: 0,
    },
  };

  const crewDoc = docs.find((d) => d.reportType === "logten_crew");
  const aircraftDoc = docs.find((d) => d.reportType === "logten_aircraft");
  const flightsDoc = docs.find((d) => d.reportType === "logten_flights");

  if (!crewDoc && !aircraftDoc && !flightsDoc) {
    plan.errors.push({
      line: 0,
      message: "No LogTen Pro export recognised in the selected files.",
    });
    return plan;
  }
  plan.sources = {
    crew: crewDoc?.fileName,
    aircraft: aircraftDoc?.fileName,
    flights: flightsDoc?.fileName,
  };

  const currentUser = await getCurrentUserPersonnel();
  if (!currentUser && flightsDoc) {
    plan.errors.push({
      line: 0,
      message:
        "No pilot profile found. Create a crew member with 'This is me' enabled before importing flights.",
    });
    return plan;
  }

  // ---- 1. Address Book ----
  onProgress?.(10, "Reading", "Address book");
  const existingPersonnel = await getAllPersonnel().catch(() => []);
  if (crewDoc) {
    plan.crew = parseLogtenAddressBook(crewDoc, {
      existingPersonnel,
      currentUser,
    });
  }

  // ---- 2. Aircraft ----
  onProgress?.(25, "Reading", "Aircraft");
  if (aircraftDoc) {
    const existingAircraft = await getAllAircraft().catch(() => []);
    plan.aircraft = parseLogtenAircraft(aircraftDoc, { existingAircraft });
  }

  // ---- 3. Flights ----
  if (flightsDoc && currentUser) {
    onProgress?.(35, "Resolving", "Airports");

    const airportCodes = collectAirportCodes(flightsDoc);
    const airports = new Map<string, Airport>();
    const offsets = new Map<string, number>();

    if (!options.skipEnrichment && airportCodes.length > 0) {
      const enriched = await enrichAirportBatch(airportCodes, ({ current, total, code }) => {
        onProgress?.(
          35 + Math.floor((current / total) * 20),
          "Resolving airports",
          `${current}/${total}: ${code}`
        );
      });
      for (const [code, airport] of enriched.enriched) {
        airports.set(code, airport);
      }
    }
    for (const [code, airport] of airports) {
      try {
        offsets.set(code, getAirportTimeInfo(airport.tz).offset);
      } catch {
        // A malformed tz is not a reason to drop the airport — the flight
        // imports with a zero offset and a warning from the parser.
      }
    }

    onProgress?.(60, "Mapping", "Flights");

    const allFlights = await userDb.flights.toArray().catch(() => [] as FlightLog[]);
    const existingFlights = allFlights.filter(isLiveFlight);

    // Crew discovered in the address book is available to the flight rows, so
    // "Ong Kok Boon" in a PIC column resolves to the record the address book
    // is about to create rather than a second copy of him.
    const personnelPool = [
      ...existingPersonnel,
      ...plan.crew.toCreate.map((r) => r.personnel),
    ];

    plan.flights = parseLogtenFlights(
      flightsDoc,
      {
        currentUser,
        existingPersonnel: personnelPool,
        existingFlights,
        airports,
        offsets,
        typeByRegistration: plan.aircraft.typeByRegistration,
      },
      {
        ...options,
        onProgress: (percent, stage, detail) =>
          onProgress?.(60 + Math.floor(percent * 0.35), stage, detail),
      }
    );

    // Registrations only referenced by flight rows still deserve a fleet entry;
    // the executor creates them from the flight's own type.
    plan.flights.registrations = Array.from(
      new Set([...plan.flights.registrations, ...collectRegistrations(flightsDoc)])
    );
  }

  // ---- Roll up ----
  for (const op of plan.flights.operations) {
    if (op.kind === "create") {
      if (op.flight.entryType === "simulator") plan.summary.simulatorsToCreate++;
      else plan.summary.flightsToCreate++;
    } else if (op.kind === "update_fill") plan.summary.flightsToUpdate++;
    else plan.summary.flightsDuplicate++;
  }
  plan.summary.crewToCreate = plan.crew.toCreate.length;
  plan.summary.crewToUpdate = plan.crew.toUpdate.length;
  plan.summary.aircraftToCreate = plan.aircraft.toCreate.length;
  plan.summary.aircraftToUpdate = plan.aircraft.toUpdate.length;
  plan.summary.rowsSkipped =
    plan.crew.skipped.length +
    plan.aircraft.skipped.length +
    plan.flights.skipped.length;

  plan.errors = [
    ...plan.crew.errors,
    ...plan.aircraft.errors,
    ...plan.flights.errors,
    ...plan.errors,
  ];
  plan.warnings = [
    ...plan.crew.warnings,
    ...plan.aircraft.warnings,
    ...plan.flights.warnings,
  ];

  // A migration with some unreadable rows is still a successful migration —
  // the rows that parsed are worth importing, and the issues are reported.
  // Only a file-level failure (no header, no rows, no profile) is fatal.
  plan.success = plan.errors.every((e) => e.line !== 0);
  onProgress?.(100, "Ready", `${plan.summary.flightsToCreate} flights to import`);

  return plan;
}
