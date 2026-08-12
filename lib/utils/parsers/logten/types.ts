/**
 * Plan shapes for a LogTen Pro migration.
 *
 * Like every other importer in the app, the parsers here perform NO writes:
 * they emit a plan describing what would happen, and `executeLogtenImport`
 * applies it. That split is what lets the UI show a summary first and what
 * makes the whole mapping testable without IndexedDB.
 *
 * A LogTen migration is deliberately NOT run through `reconcileRoster`. That
 * reconciler exists for the RECURRING eCrew import — it forces flight numbers
 * into the `TR…` house style, files anything else as `skip_non_airline`, and
 * decides ownership of fields between a pilot and their company. A migration
 * is the opposite situation: a one-time bulk load of a logbook the pilot
 * already owns outright, from any carrier, where the only question per row is
 * "do I already have this flight?".
 */

import type { Aircraft } from "@/types/entities/aircraft.types";
import type { FlightLog, FlightLogCreate } from "@/types/entities/flight.types";
import type { Personnel } from "@/types/entities/crew.types";

/** Where a LogTen export's clock times are expressed. */
export type LogtenTimeReference = "utc" | "local";

export interface LogtenIssue {
  /** 1-based line in the source file. 0 for a file-level problem. */
  line: number;
  message: string;
  /** The offending row, truncated — omitted for file-level issues. */
  raw?: string;
}

/**
 * A crew member from the Address Book tab.
 *
 * `matchedPersonnelId` is set when the name resolves to somebody already in
 * the app, in which case the import BACKFILLS the blank fields rather than
 * creating a second row for the same person.
 */
export interface LogtenCrewPlanRow {
  personnel: Personnel;
  matchedPersonnelId: string | null;
  /** Fields that would be written onto the matched record. */
  patch: Partial<Personnel>;
  /** LogTen's "This is Me" flag, before the self-collision rule is applied. */
  claimsSelf: boolean;
  sourceLine: number;
}

export interface LogtenCrewPlan {
  toCreate: LogtenCrewPlanRow[];
  toUpdate: LogtenCrewPlanRow[];
  skipped: LogtenIssue[];
  warnings: LogtenIssue[];
  errors: LogtenIssue[];
}

export interface LogtenAircraftPlanRow {
  /** A create payload; `id` is assigned by the store. */
  aircraft: Omit<Aircraft, "id" | "createdAt" | "syncStatus">;
  matchedAircraftId: string | null;
  patch: Partial<Aircraft>;
  sourceLine: number;
}

export interface LogtenAircraftPlan {
  toCreate: LogtenAircraftPlanRow[];
  toUpdate: LogtenAircraftPlanRow[];
  skipped: LogtenIssue[];
  warnings: LogtenIssue[];
  errors: LogtenIssue[];
  /** Registration → ICAO type designator, for the flight parser to fall back on. */
  typeByRegistration: Map<string, string>;
}

/**
 * What a migrated flight row becomes.
 *
 *  - `create`         — nothing in the logbook matches; insert it.
 *  - `skip_duplicate` — an equivalent flight is already there and already
 *                       carries the fields this row would bring. Left alone.
 *  - `update_fill`    — an equivalent flight is there but is MISSING fields
 *                       this row has (a flight entered by hand before the
 *                       migration, say). Only blanks are filled; nothing the
 *                       user already recorded is overwritten.
 */
export type LogtenFlightOperation =
  | {
      kind: "create";
      flight: FlightLogCreate;
      sourceLine: number;
      label: string;
    }
  | {
      kind: "skip_duplicate";
      existing: FlightLog;
      sourceLine: number;
      label: string;
    }
  | {
      kind: "update_fill";
      existing: FlightLog;
      patch: Partial<FlightLog>;
      filledFields: string[];
      sourceLine: number;
      label: string;
    };

export interface LogtenFlightPlan {
  operations: LogtenFlightOperation[];
  /** The reference the clock times were read as, and how that was decided. */
  timeReference: LogtenTimeReference;
  timeReferenceConfidence: "detected" | "assumed" | "forced";
  /** Evidence behind a detected reference — surfaced in the review summary. */
  timeReferenceEvidence: string;
  dateRange: { start: string; end: string };
  /** Registrations seen, uppercased. */
  registrations: string[];
  /** Airport codes seen, uppercased. */
  airportCodes: string[];
  /** Codes no source could resolve — their flights still import, without a tz. */
  unresolvedAirports: string[];
  /** New crew discovered in the flight rows themselves (not the address book). */
  personnelToCreate: Personnel[];
  skipped: LogtenIssue[];
  warnings: LogtenIssue[];
  errors: LogtenIssue[];
}

export interface LogtenImportPlan {
  success: boolean;
  crew: LogtenCrewPlan;
  aircraft: LogtenAircraftPlan;
  flights: LogtenFlightPlan;
  /** Which of the three files were actually supplied. */
  sources: { crew?: string; aircraft?: string; flights?: string };
  errors: LogtenIssue[];
  warnings: LogtenIssue[];
  summary: {
    flightsToCreate: number;
    flightsToUpdate: number;
    flightsDuplicate: number;
    simulatorsToCreate: number;
    crewToCreate: number;
    crewToUpdate: number;
    aircraftToCreate: number;
    aircraftToUpdate: number;
    rowsSkipped: number;
  };
}

export interface LogtenParseOptions {
  onProgress?: (percent: number, stage: string, detail?: string) => void;
  /**
   * Override the clock-time reference instead of detecting it. LogTen's export
   * carries no marker, so detection compares each cross-timezone sector's
   * out→in span against the block time it recorded; a single-timezone
   * operation gives it nothing to work with and this is the escape hatch.
   */
  timeReference?: LogtenTimeReference;
  /** How to read an ambiguous numeric date. Ignored for LogTen's ISO dates. */
  dateOrder?: "auto" | "dmy" | "mdy";
  /**
   * Keep the values LogTen recorded (night, role times, day/night takeoffs
   * and landings) by marking them as manual overrides, rather than letting the
   * app recompute them from sun position on first save.
   *
   * On by default, and it is the right default for a migration: the file being
   * imported IS the pilot's existing legal record, and silently recomputing it
   * would change totals they have already certified. Only fields LogTen left
   * blank get computed.
   */
  preserveSourceValues?: boolean;
  /** Skip the network enrichment chains (tests, offline). */
  skipEnrichment?: boolean;
}
