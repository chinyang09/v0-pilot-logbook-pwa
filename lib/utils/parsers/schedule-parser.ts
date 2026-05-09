/**
 * Scoot Schedule CSV Parser — v2
 *
 * Parses "Personal Crew Schedule Report" exports (UTC, Local Base, or Local
 * Station) and returns a PlannedImport describing what WOULD happen — no DB
 * writes occur here. The caller (roster page) presents the plan to the user,
 * the user accepts/rejects per operation, and then executeRosterImport()
 * applies the approved changes.
 *
 * This parser:
 *   1. Reads the CSV header to determine time reference + date range.
 *   2. Extracts each sector's raw times.
 *   3. Normalizes every time to UTC via time-reference-normalizer.
 *   4. Calls reconcileRoster() to classify operations against existing flights.
 *
 * Currency + personnel handling (which the old parser also did) is kept here
 * so callers can use it for side-effect writes separately from flight
 * reconciliation. Crew/currency writes happen inside executeRosterImport()
 * and always proceed — only flight operations go through the review modal.
 */

import type {
  ScheduledCrewMember,
  Currency,
  TimeReference,
  CrewRole,
} from "@/types/entities/roster.types";
import type { Personnel } from "@/types/entities/crew.types";
import type { FlightLog } from "@/types/entities/flight.types";
import {
  userDb,
  getAirportByIata,
  getAllPersonnel,
  getCurrentUserPersonnel,
} from "@/lib/db";
import {
  normalizeTimeToUTC,
  parseTimeToken,
} from "./time-reference-normalizer";
import {
  reconcileRoster,
  type ParsedSector,
  type ReconcilerOperation,
} from "@/lib/utils/roster/reconciler";
import { splitCsvRows, parseCSVLine, parseDDMMYYYY } from "./shared/csv-split";
import { normalize } from "./shared/name-normalize";
import { parseGeneratedAt } from "./shared/generated-at";

// ============================================================
// Public types
// ============================================================

export interface PlannedImport {
  success: boolean;
  timeReference: TimeReference;
  dateRange: { start: string; end: string };
  /**
   * "Generated on..." footer of the source report (epoch ms in UTC).
   * Null when the footer wasn't found — stale-report gating disabled.
   */
  generatedAt: number | null;
  crewMember: {
    crewId: string;
    name: string;
    base: string;
    role: string;
    aircraftType: string;
  };
  /** Operations from the reconciler — user opts in per row. */
  operations: AcceptableOperation[];
  /** Currency updates — always executed, not user-reviewed. */
  currencies: Omit<Currency, "id" | "createdAt" | "syncStatus">[];
  /** New pilot crew discovered — always executed. */
  personnelToCreate: Personnel[];
  personnelToUpdate: { id: string; data: Partial<Personnel> }[];
  errors: Array<{ line: number; message: string; raw?: string }>;
  warnings: Array<{ line: number; message: string }>;
  summary: {
    toCreate: number;
    toUpdate: number;
    toDelete: number;
    identical: number;
    ignored: number;
    staleSkipped: number;
  };
}

/** A reconciler op plus an acceptance flag. Defaults vary by kind. */
export type AcceptableOperation = ReconcilerOperation & { accepted: boolean };

export interface ParseOptions {
  onProgress?: (percent: number, stage: string, detail?: string) => void;
  sourceFile?: string;
}

// ============================================================
// Constants
// ============================================================

const CREW_ROLE_MAP: Record<string, CrewRole> = {
  CPT: "CPT",
  PIC: "PIC",
  FO: "FO",
};

// ============================================================
// Header parsing
// ============================================================

interface ParsedHeader {
  timeReference: TimeReference;
  dateRange: { start: string; end: string };
  crewInfo: PlannedImport["crewMember"];
  columnIndices: {
    date: number;
    duties: number;
    details: number;
    reportTimes: number;
    actualTimes: number;
    debriefTimes: number;
    indicators: number;
    crew: number;
  };
  dataStartIndex: number;
}

function parseHeader(lines: string[]): ParsedHeader {
  let timeReference: TimeReference = "UTC";
  let dateRange = { start: "", end: "" };

  for (const line of lines.slice(0, 10)) {
    if (line.includes("All times in")) {
      if (line.includes("Local Base")) timeReference = "LOCAL_BASE";
      else if (line.includes("Local Station")) timeReference = "LOCAL_STATION";
      else timeReference = "UTC";

      const rangeMatch = line.match(
        /(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})/
      );
      if (rangeMatch) {
        dateRange = {
          start: parseDDMMYYYY(rangeMatch[1]),
          end: parseDDMMYYYY(rangeMatch[2]),
        };
      }
      break;
    }
  }

  // Crew info line — e.g. "9766 Lim Chin Yang SIN-FO-32N"
  let crewInfo: PlannedImport["crewMember"] = {
    crewId: "",
    name: "",
    base: "",
    role: "",
    aircraftType: "",
  };
  for (const line of lines.slice(0, 10)) {
    const match = line.match(
      /^(\d+)\s+(.+?)\s+([A-Z]{3})-(\w+)-(\w+)/
    );
    if (match) {
      crewInfo = {
        crewId: match[1],
        name: match[2].trim(),
        base: match[3],
        role: match[4],
        aircraftType: match[5],
      };
      break;
    }
  }

  // Column header row
  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    if (
      lines[i].includes("Date") &&
      lines[i].includes("Duties") &&
      lines[i].includes("Details")
    ) {
      headerRowIndex = i;
      break;
    }
  }
  if (headerRowIndex === -1) {
    throw new Error("Could not locate schedule column header row");
  }

  const headerCols = parseCSVLine(lines[headerRowIndex]).map((c) =>
    c.toLowerCase()
  );
  const idx = (needle: string) =>
    headerCols.findIndex((c) => c.includes(needle));

  const columnIndices = {
    date: idx("date"),
    duties: idx("duties"),
    details: idx("details"),
    reportTimes: idx("report"),
    actualTimes: idx("actual"),
    debriefTimes: idx("debrief"),
    indicators: idx("indicator"),
    crew: idx("crew"),
  };

  return {
    timeReference,
    dateRange,
    crewInfo,
    columnIndices,
    dataStartIndex: headerRowIndex + 1,
  };
}

// ============================================================
// Sector extraction (raw, pre-normalization)
// ============================================================

interface RawSector {
  flightNumber: string;
  aircraftType: string;
  departureIata: string;
  arrivalIata: string;
  /** Raw tokens from CSV — still carrying 'A' prefix and ⁺¹ markers */
  rawSchedOut?: string;
  rawSchedIn?: string;
  rawActualOut?: string;
  rawActualIn?: string;
  rowDate: string;
  sourceLine: number;
  crew?: ScheduledCrewMember[];
}

function extractSectorsFromRow(
  row: string,
  header: ParsedHeader,
  lineNumber: number
): RawSector[] {
  const cols = parseCSVLine(row);
  const rowDate = parseDDMMYYYY(cols[header.columnIndices.date] || "");
  if (!rowDate) return [];

  const dutiesCell = cols[header.columnIndices.duties] || "";
  const detailsCell = cols[header.columnIndices.details] || "";
  const actualsCell = cols[header.columnIndices.actualTimes] || "";

  const dutyLines = dutiesCell.split(/\r?\n/).filter(Boolean);
  const detailLines = detailsCell.split(/\r?\n/).filter(Boolean);
  const actualLines = actualsCell.split(/\r?\n/).filter(Boolean);

  const sectors: RawSector[] = [];

  for (let i = 0; i < dutyLines.length; i++) {
    const dutyLine = dutyLines[i].trim();
    const detailLine = detailLines[i]?.trim() || "";
    const actualLine = actualLines[i]?.trim() || "";

    const flightMatch = dutyLine.match(/^(\w*\d+)\s*\[(\w+)\]$/);
    if (!flightMatch) continue;

    let flightNumber = flightMatch[1];
    const hasPrefix = /[A-Za-z]/.test(flightNumber.replace(/\d/g, ""));
    if (!hasPrefix) flightNumber = `TR${flightNumber}`;

    const routeMatch = detailLine.match(/^(\w{3})\s*-\s*(\w{3})/);
    if (!routeMatch) continue;

    // Parse actual-times line — may be scheduled-only, actual-only, or mixed.
    const timeMatch = actualLine.match(
      /(A?\d{2}:\d{2}(?:⁺¹)?)\s*-\s*(A?\d{2}:\d{2}(?:⁺¹)?)/
    );

    const sector: RawSector = {
      flightNumber,
      aircraftType: flightMatch[2],
      departureIata: routeMatch[1].toUpperCase(),
      arrivalIata: routeMatch[2].toUpperCase(),
      rowDate,
      sourceLine: lineNumber,
    };

    if (timeMatch) {
      const outParsed = parseTimeToken(timeMatch[1]);
      const inParsed = parseTimeToken(timeMatch[2]);
      if (outParsed) {
        if (outParsed.isActual) sector.rawActualOut = timeMatch[1];
        else sector.rawSchedOut = timeMatch[1];
      }
      if (inParsed) {
        if (inParsed.isActual) sector.rawActualIn = timeMatch[2];
        else sector.rawSchedIn = timeMatch[2];
      }
    }

    sectors.push(sector);
  }

  return sectors;
}

// ============================================================
// Normalization to ParsedSector (UTC)
// ============================================================

interface AirportLookup {
  (iata: string): Promise<{ tz: string } | undefined>;
}

async function normalizeSector(
  raw: RawSector,
  header: ParsedHeader,
  lookupAirport: AirportLookup,
  baseTz: string | undefined,
  warnings: PlannedImport["warnings"]
): Promise<ParsedSector | null> {
  const [dep, arr] = await Promise.all([
    lookupAirport(raw.departureIata),
    lookupAirport(raw.arrivalIata),
  ]);

  if (!dep || !arr) {
    warnings.push({
      line: raw.sourceLine,
      message: `Unknown airport: ${!dep ? raw.departureIata : ""}${!dep && !arr ? " and " : ""}${!arr ? raw.arrivalIata : ""} — using UTC offset 0`,
    });
  }

  const depTz = dep?.tz || "Etc/UTC";
  const arrTz = arr?.tz || "Etc/UTC";

  const norm = (rawTime: string | undefined, role: "out" | "in") =>
    rawTime
      ? normalizeTimeToUTC({
          rawTime,
          rowDate: raw.rowDate,
          timeReference: header.timeReference,
          role,
          depTz,
          arrTz,
          baseTz,
        })
      : null;

  const schedOut = norm(raw.rawSchedOut, "out");
  const schedIn = norm(raw.rawSchedIn, "in");
  const actOut = norm(raw.rawActualOut, "out");
  const actIn = norm(raw.rawActualIn, "in");

  // UTC date of the flight anchors on OUT (preferring actual when present).
  const anchor = actOut || schedOut;
  if (!anchor) {
    warnings.push({
      line: raw.sourceLine,
      message: `Sector ${raw.flightNumber} has no parseable OUT time — skipping`,
    });
    return null;
  }

  return {
    date: anchor.utcDate,
    flightNumber: raw.flightNumber,
    aircraftType: raw.aircraftType,
    departureIata: raw.departureIata,
    arrivalIata: raw.arrivalIata,
    scheduledOut: schedOut?.utcTime,
    scheduledIn: schedIn?.utcTime,
    actualOut: actOut?.utcTime,
    actualIn: actIn?.utcTime,
    sourceLine: raw.sourceLine,
    crew: raw.crew,
  };
}

// ============================================================
// Crew parsing (pilots only)
// ============================================================

function parseCrewColumn(crewCell: string): ScheduledCrewMember[] {
  const crew: ScheduledCrewMember[] = [];
  const lines = crewCell.split(/\r?\n/).filter(Boolean);

  for (const line of lines) {
    const match = line.match(
      /^([A-Z\s]+?)\s-\s(?:[A-Z\s]+?\s-\s)?(\d+)\s-\s(.+)$/
    );
    if (!match) continue;

    const rolePart = match[1].trim().toUpperCase();
    const crewId = match[2];
    const name = match[3].trim();

    if (CREW_ROLE_MAP[rolePart]) {
      crew.push({ role: CREW_ROLE_MAP[rolePart], crewId, name });
    }
  }
  return crew;
}

// ============================================================
// Currency parsing
// ============================================================

function parseCurrencies(
  lines: string[],
  startIndex: number
): Omit<Currency, "id" | "createdAt" | "syncStatus">[] {
  const currencies: Omit<Currency, "id" | "createdAt" | "syncStatus">[] = [];

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("Training") || line.startsWith("Memos")) break;

    const cols = parseCSVLine(line);
    const code = cols.find((c) => c && /^[A-Z]/.test(c));
    if (!code) continue;

    const description =
      cols.find(
        (c, idx) => idx > 0 && c.length > 2 && !/^\d{2}\/\d{2}\/\d{4}$/.test(c)
      ) || "";

    const dateCol = cols.find((c) => /^\d{2}\/\d{2}\/\d{4}$/.test(c));
    if (!dateCol) continue;

    currencies.push({
      code,
      description: description || code,
      expiryDate: parseDDMMYYYY(dateCol),
      warningDays: 30,
      criticalDays: 7,
      autoUpdate: true,
      lastUpdatedFrom: "schedule_csv",
    });
  }

  return currencies;
}

// ============================================================
// Main entry point
// ============================================================

export async function parseScheduleCSV(
  csvContent: string,
  options: ParseOptions = {}
): Promise<PlannedImport> {
  const { onProgress } = options;
  const lines = splitCsvRows(csvContent);

  const plan: PlannedImport = {
    success: false,
    timeReference: "UTC",
    dateRange: { start: "", end: "" },
    generatedAt: null,
    crewMember: { crewId: "", name: "", base: "", role: "", aircraftType: "" },
    operations: [],
    currencies: [],
    personnelToCreate: [],
    personnelToUpdate: [],
    errors: [],
    warnings: [],
    summary: {
      toCreate: 0,
      toUpdate: 0,
      toDelete: 0,
      identical: 0,
      ignored: 0,
      staleSkipped: 0,
    },
  };

  try {
    onProgress?.(5, "Parsing", "Reading CSV header...");
    plan.generatedAt = parseGeneratedAt(csvContent);
    if (plan.generatedAt === null) {
      plan.warnings.push({
        line: 0,
        message:
          "Could not find a 'Generated on' footer — stale-report protection is disabled for this import.",
      });
    }
    const header = parseHeader(lines);
    plan.timeReference = header.timeReference;
    plan.dateRange = header.dateRange;
    plan.crewMember = header.crewInfo;

    onProgress?.(10, "Validating", "Checking user profile...");
    const currentUser = await getCurrentUserPersonnel();
    if (!currentUser) {
      throw new Error(
        "No user profile found. Please create a crew member with 'This is me' enabled."
      );
    }

    // Base airport TZ (required for LOCAL_BASE; informational otherwise)
    const baseAirport = await getAirportByIata(header.crewInfo.base);
    const baseTz = baseAirport?.tz;

    // Airport lookup with in-import cache
    const airportCache = new Map<string, { tz: string } | undefined>();
    const lookupAirport = async (
      iata: string
    ): Promise<{ tz: string } | undefined> => {
      if (airportCache.has(iata)) return airportCache.get(iata);
      const a = await getAirportByIata(iata);
      const entry = a?.tz ? { tz: a.tz } : undefined;
      airportCache.set(iata, entry);
      return entry;
    };

    onProgress?.(15, "Loading", "Fetching existing personnel...");
    const existingPersonnel = await getAllPersonnel();
    const crewCache = new Map<string, string>();
    existingPersonnel.forEach((p) => {
      crewCache.set(p.name.toLowerCase(), p.id);
      if (p.crewId) crewCache.set(p.crewId, p.id);
    });

    onProgress?.(20, "Parsing", "Extracting sectors...");

    // Stage A: raw extraction per row
    const rawSectors: RawSector[] = [];
    const currencyStartMarker = "Code,,,Description";
    let currencyStartIdx = -1;

    for (let i = header.dataStartIndex; i < lines.length; i++) {
      const row = lines[i];
      if (row.includes(currencyStartMarker)) {
        currencyStartIdx = i + 1;
        break;
      }
      if (!row.trim() || row.startsWith("Total Hours")) continue;

      const cols = parseCSVLine(row);
      const duties = cols[header.columnIndices.duties] || "";
      if (!duties.match(/\d+\s*\[/)) continue; // not a flight row

      try {
        const sectors = extractSectorsFromRow(row, header, i + 1);

        // Crew → personnel diff
        const crewMembers = parseCrewColumn(
          cols[header.columnIndices.crew] || ""
        );
        for (const member of crewMembers) {
          const normalizedName = normalize(member.name);
          if (crewCache.has(normalizedName) || crewCache.has(member.crewId)) {
            member.personnelId = crewCache.get(normalizedName) || crewCache.get(member.crewId);
            continue;
          }
          const truncatedMatch = existingPersonnel.find(
            (p) =>
              !p.crewId && normalizedName.startsWith(normalize(p.name))
          );
          if (truncatedMatch) {
            plan.personnelToUpdate.push({
              id: truncatedMatch.id,
              data: {
                name: member.name,
                crewId: member.crewId,
                updatedAt: Date.now(),
              },
            });
            crewCache.set(normalizedName, truncatedMatch.id);
            crewCache.set(member.crewId, truncatedMatch.id);
            member.personnelId = truncatedMatch.id;
          } else {
            const newPerson: Personnel = {
              id: crypto.randomUUID(),
              name: member.name,
              crewId: member.crewId,
              organization: "Scoot",
              roles: member.role === "FO" ? ["SIC"] : ["PIC"],
              isMe: false,
              createdAt: Date.now(),
              syncStatus: "pending",
            };
            plan.personnelToCreate.push(newPerson);
            crewCache.set(normalizedName, newPerson.id);
            crewCache.set(member.crewId, newPerson.id);
            member.personnelId = newPerson.id;
          }
        }

        for (const sector of sectors) {
          sector.crew = crewMembers;
        }
        rawSectors.push(...sectors);
      } catch (error) {
        plan.errors.push({
          line: i + 1,
          message:
            error instanceof Error
              ? error.message
              : "Error parsing row",
        });
      }
    }

    onProgress?.(50, "Normalizing", "Converting times to UTC...");

    // Stage B: normalize to UTC — sequential per sector
    const parsedSectors: ParsedSector[] = [];
    for (const raw of rawSectors) {
      const normalized = await normalizeSector(
        raw,
        header,
        lookupAirport,
        baseTz,
        plan.warnings
      );
      if (normalized) parsedSectors.push(normalized);
    }

    onProgress?.(75, "Reconciling", "Comparing against existing flights...");

    // Stage C: load existing flights within the CSV date range
    const rangeStart = header.dateRange.start;
    const rangeEnd = header.dateRange.end;
    const allFlights = await userDb.flights.toArray();
    const flightsInRange = allFlights.filter(
      (f: FlightLog) => f.date >= rangeStart && f.date <= rangeEnd
    );

    const operations = reconcileRoster({
      sectors: parsedSectors,
      existingFlights: flightsInRange,
      csvDateRange: { start: rangeStart, end: rangeEnd },
      reportGeneratedAt: plan.generatedAt,
    });

    // Apply default acceptance flags
    plan.operations = operations.map((op) => ({
      ...op,
      accepted:
        op.kind === "create" ||
        op.kind === "skip_identical" ||
        op.kind === "skip_non_airline" ||
        op.kind === "skip_stale_report" ||
        op.kind === "update_safe",
    }));

    // Summary counts
    for (const op of plan.operations) {
      switch (op.kind) {
        case "create":
          plan.summary.toCreate++;
          break;
        case "update_conflict":
        case "edited_conflict":
        case "update_safe":
        case "update_consult":
          plan.summary.toUpdate++;
          break;
        case "delete_missing":
          plan.summary.toDelete++;
          break;
        case "skip_identical":
          plan.summary.identical++;
          break;
        case "skip_non_airline":
          plan.summary.ignored++;
          break;
        case "skip_stale_report":
          plan.summary.staleSkipped++;
          break;
      }
    }

    // Currencies
    onProgress?.(90, "Parsing", "Reading currency dates...");
    if (currencyStartIdx > 0) {
      plan.currencies = parseCurrencies(lines, currencyStartIdx);
    }

    onProgress?.(100, "Complete", "Plan ready for review");
    plan.success = plan.errors.length === 0;
  } catch (error) {
    plan.errors.push({
      line: 0,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    plan.success = false;
  }

  return plan;
}

// ============================================================
// CSV type detector (unchanged from v1)
// ============================================================

export function detectCSVType(
  csvContent: string
): "schedule" | "logbook" | "unknown" {
  const firstLines = csvContent.split(/\r?\n/).slice(0, 10).join("\n");
  if (firstLines.includes("Personal Crew Schedule Report")) return "schedule";
  if (firstLines.includes("Crew Logbook Report")) return "logbook";
  return "unknown";
}

