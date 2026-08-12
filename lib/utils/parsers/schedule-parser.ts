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
  isLiveFlight,
  getAirportByIata,
  getAirportTimeInfo,
  getAllPersonnel,
  getCurrentUserPersonnel,
  getUserPreferences,
  DEFAULT_IMPORT_DEFAULTS,
} from "@/lib/db";
import type { ImportDefaults } from "@/types/db/stores.types";
import type { ParsedSimSession } from "./logbook-parser-v2";
import { parseTrainingDetails } from "./shared/training-details";
import {
  normalizeTimeToUTC,
  parseTimeToken,
} from "./time-reference-normalizer";
import {
  reconcileRoster,
  type ParsedSector,
  type ReconcilerOperation,
  type FieldDiff,
} from "@/lib/utils/roster/reconciler";
import { parseDDMMYYYY } from "./shared/csv-split";
import type { NormalizedDocument, NormalizedRow } from "./types";
import { normalize } from "./shared/name-normalize";
import { parseGeneratedAt } from "./shared/generated-at";
import {
  applyDefaultAcceptance,
  summarizeOperations,
} from "@/lib/utils/roster/plan-summary";
import { normalizeAircraftType } from "./shared/aircraft-type-map";
import { enrichAirportBatch } from "./shared/airport-enricher";

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
  /**
   * Simulator / training sessions (EBT etc.) parsed from the schedule. The
   * executor logs these as FlightLog entries so they count toward the
   * dashboard's simulator totals. Applied outside the flight review modal.
   */
  simSessions: ParsedSimSession[];
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

/**
 * A reconciler op plus an acceptance flag. Defaults vary by kind.
 *
 * `declinedChanges` carries field changes the user explicitly turned down on
 * an otherwise-accepted row (e.g. keeping their recorded pilot-flying value),
 * so the executor can remember the decision and not re-raise it next time.
 */
export type AcceptableOperation = ReconcilerOperation & {
  accepted: boolean;
  declinedChanges?: FieldDiff[];
};

export interface ParseOptions {
  onProgress?: (percent: number, stage: string, detail?: string) => void;
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

function parseHeader(rows: NormalizedRow[]): ParsedHeader {
  let timeReference: TimeReference = "UTC";
  let dateRange = { start: "", end: "" };

  for (const { raw: line } of rows.slice(0, 10)) {
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
  for (const { raw: line } of rows.slice(0, 10)) {
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
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    if (
      rows[i].raw.includes("Date") &&
      rows[i].raw.includes("Duties") &&
      rows[i].raw.includes("Details")
    ) {
      headerRowIndex = i;
      break;
    }
  }
  if (headerRowIndex === -1) {
    throw new Error("Could not locate schedule column header row");
  }

  const headerCols = rows[headerRowIndex].cells.map((c) => c.toLowerCase());
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
// PDF row regrouping
// ============================================================
//
// The schedule PDF renders each visual table row across 3 - 10 separate
// Y-buckets (top sector, date row, bottom sector, plus crew lines above and
// below). The PDF extractor preserves the underlying Y-coordinate on each
// NormalizedRow, but only one of those buckets — the date row — carries the
// date in the date column. The plain row iterator below was skipping every
// other bucket, which produced "TR278/TR589/…" as orphan deletions because
// the parser never saw the imported flights in the report.
//
// `mergePdfTableRows` walks the data section in document order, drops page
// header / column header / footer artifacts, and groups consecutive PDF
// rows whose Y-coordinates are within `BLOCK_GAP_PX` into a single merged
// row whose cells are newline-joined. After merging, the downstream
// `extractSectorsFromRow` logic — already designed for the multi-line CSV
// cell format — works unchanged on both CSV and PDF inputs.
//
// Threshold tuning: empirical row spacing on Scoot's schedule export is
// ~4 - 10 px between rows of the same entry (sector/date/sector are spaced
// 4 - 5 px; crew lines 9 - 10 px), and 11 - 18 px between entries. 11.0
// cleanly separates every observed boundary without bisecting any entry.

const BLOCK_GAP_PX = 11.0;

function isPdfArtifactRow(row: NormalizedRow): boolean {
  const r = row.raw;
  if (!r.trim()) return true;
  if (r.includes("Personal Crew Schedule Report")) return true;
  if (r.includes("Scoot Pte Ltd")) return true;
  if (r.includes("Schedule Details")) return true;
  if (r.includes("All times in")) return true;
  if (r.startsWith("Generated on") || r.includes(",Generated on")) return true;
  // Column header repeat on subsequent pages
  if (
    row.cells[0]?.trim() === "Date" &&
    (row.cells[1]?.trim() === "Duties" || row.cells[1]?.trim() === "Time")
  ) {
    return true;
  }
  return false;
}

function isScheduleDateRow(row: NormalizedRow, dateColIdx: number): boolean {
  return /^\d{2}\/\d{2}\/\d{4}/.test((row.cells[dateColIdx] || "").trim());
}

/**
 * Merge consecutive rows whose Y values fall within BLOCK_GAP_PX into a
 * single row with newline-joined cells. CSV input — which has undefined `y`
 * — passes through unchanged. The returned array is the same shape as the
 * input so downstream code reads it identically.
 */
function mergePdfTableRows(
  rows: NormalizedRow[],
  header: ParsedHeader
): NormalizedRow[] {
  // Detect format from the first data row's Y. CSV rows have no Y and
  // already pack multiple sectors into a single cell — no merge needed.
  const firstDataRow = rows[header.dataStartIndex];
  if (!firstDataRow || firstDataRow.y === undefined) return rows;

  const dateColIdx = header.columnIndices.date;
  const dataStart = header.dataStartIndex;

  // Find the end of the schedule section. We stop at the "Total Hours and
  // Statistics" or "Code,,,Description" marker, whichever appears first.
  let dataEnd = rows.length;
  for (let i = dataStart; i < rows.length; i++) {
    const r = rows[i].raw;
    if (
      r.includes("Total Hours and Statistics") ||
      r.startsWith("Total Hours") ||
      r.includes("Code,,,Description") ||
      r.includes("Expiry Dates")
    ) {
      dataEnd = i;
      break;
    }
  }

  const out: NormalizedRow[] = [];
  for (let i = 0; i < dataStart; i++) out.push(rows[i]);

  let block: NormalizedRow[] = [];
  let lastY: number | null = null;

  const flush = () => {
    if (block.length === 0) return;
    if (block.length === 1) {
      out.push(block[0]);
      block = [];
      return;
    }
    const numCols = block.reduce((m, r) => Math.max(m, r.cells.length), 0);
    const merged: string[] = new Array(numCols).fill("");
    let dateRowsSeen = 0;
    for (const r of block) {
      if (isScheduleDateRow(r, dateColIdx)) dateRowsSeen++;
      for (let j = 0; j < r.cells.length; j++) {
        const v = (r.cells[j] || "").trim();
        if (!v) continue;
        merged[j] = merged[j] ? `${merged[j]}\n${v}` : v;
      }
    }
    // Sanity: two date rows merged into one entry means the Y threshold is
    // too lax. We log and split conservatively rather than corrupt the
    // import. Each row is re-emitted standalone so downstream parsing at
    // least picks up the date-bearing rows.
    if (dateRowsSeen > 1) {
      console.warn(
        `[Schedule parser] Y-gap merge produced ${dateRowsSeen} date rows ` +
          `in one block; splitting. Block size=${block.length}, Y range=` +
          `[${block[0].y?.toFixed(1)}..${block[block.length - 1].y?.toFixed(1)}]`
      );
      for (const r of block) out.push(r);
      block = [];
      return;
    }
    out.push({
      index: block[0].index,
      raw: merged.join(","),
      cells: merged,
      y: block[0].y,
    });
    block = [];
  };

  for (let i = dataStart; i < dataEnd; i++) {
    const row = rows[i];

    if (isPdfArtifactRow(row)) {
      flush();
      lastY = null;
      continue;
    }

    const y = row.y;
    if (y === undefined) {
      flush();
      out.push(row);
      lastY = null;
      continue;
    }

    if (lastY !== null && Math.abs(lastY - y) > BLOCK_GAP_PX) {
      flush();
    }
    block.push(row);
    lastY = y;
  }
  flush();

  for (let i = dataEnd; i < rows.length; i++) out.push(rows[i]);

  return out;
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
  cols: string[],
  header: ParsedHeader,
  lineNumber: number
): RawSector[] {
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
    // Supports both day-shift markers: ⁺¹ rolls forward (late-night dep), ⁻¹
    // rolls back (early-morning arr displayed under the next day's row).
    const timeMatch = actualLine.match(
      /(A?\d{2}:\d{2}(?:⁺¹|⁻¹|\+1|-1)?)\s*-\s*(A?\d{2}:\d{2}(?:⁺¹|⁻¹|\+1|-1)?)/
    );

    const sector: RawSector = {
      flightNumber,
      aircraftType: normalizeAircraftType(flightMatch[2]),
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
  (iata: string): Promise<{ tz: string; icao?: string } | undefined>;
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
    departureIcao: dep?.icao,
    arrivalIcao: arr?.icao,
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

/**
 * A line that STARTS a crew member: "CPT - PIC - 2644 - Prorok Andriy",
 * "FO - 9766 - Lim Chin Yang", "CC - 9966 - Camelia Shome Binte". The role
 * token is 1-4 uppercase letters; an optional sub-role ("PIC") sits between
 * the role and the crew id.
 */
const CREW_MEMBER_START_RE =
  /^([A-Z]{1,4})\s-\s(?:[A-Z]{1,5}\s-\s)?(\d+)\s-\s(.+)$/;

/**
 * Parse the multi-line Crew column into pilot crew members (CPT + FO only).
 *
 * The schedule PDF wraps long names onto a second line, e.g.
 *
 *   CPT - PIC - 6409 - Siah Yang Tek,
 *   Timothy
 *   FO - 9766 - Lim Chin Yang
 *
 * A continuation line ("Timothy") has no "ROLE - id - name" shape, so it is
 * appended to the crew member the previous line started. Without this the
 * captain's full name is truncated to "Siah Yang Tek," — the exact
 * lost-detail the schedule report is supposed to supply (owner: "very
 * important"). Continuation tracking spans NON-pilot rows too (CC/CL wrap as
 * well) so a wrapped cabin-crew name never bleeds onto the previous pilot.
 */
export function parseCrewColumn(crewCell: string): ScheduledCrewMember[] {
  const crew: ScheduledCrewMember[] = [];
  const lines = crewCell.split(/\r?\n/);

  let pending: { role: string; crewId: string; nameParts: string[] } | null =
    null;

  const flush = () => {
    if (!pending) return;
    const roleKey = pending.role.toUpperCase();
    if (CREW_ROLE_MAP[roleKey]) {
      const name = pending.nameParts.join(" ").replace(/\s+/g, " ").trim();
      crew.push({ role: CREW_ROLE_MAP[roleKey], crewId: pending.crewId, name });
    }
    pending = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(CREW_MEMBER_START_RE);
    if (match) {
      flush();
      pending = {
        role: match[1].trim(),
        crewId: match[2],
        nameParts: [match[3].trim()],
      };
    } else if (pending) {
      // Wrapped continuation of the previous member's name.
      pending.nameParts.push(line);
    }
  }
  flush();

  return crew;
}

// ============================================================
// Simulator / training duty detection
// ============================================================

interface RawSimDuty {
  date: string; // YYYY-MM-DD
  dutyCode: string; // "EBT1"
  description: string; // "EBT Day 1"
  startLocal?: string; // HH:MM (report time reference)
  endLocal?: string; // HH:MM
  sourceLine: number;
}

/**
 * A non-flight duty row is a simulator / training session when its code or
 * description matches a known sim/check pattern. EBT (Evidence-Based
 * Training), OPC/LPC (Operator/Licence Proficiency Check), LOFT, LOE and
 * bare "SIM" all run in the simulator. Standby / leave / off codes (SBY*,
 * LOFF, PSL, WSL, BKUP) are deliberately excluded.
 */
export function isSimulatorDuty(code: string, description: string): boolean {
  const c = (code || "").toUpperCase().trim();
  const d = (description || "").toLowerCase();
  if (/^(EBT|OPC|LPC|LOFT|LOE|LST|SIM|SIC?U|PC|LC)\d*$/.test(c)) return true;
  if (/^EBT/.test(c)) return true;
  if (
    d.includes("ebt") ||
    d.includes("simulator") ||
    d.includes("proficiency") ||
    d.includes(" sim ") ||
    d.includes("loft")
  ) {
    return true;
  }
  return false;
}

/**
 * Try to read a simulator/training session out of a NON-flight schedule row.
 * Returns null for standby / leave / off rows.
 */
function tryExtractSimDuty(
  cols: string[],
  header: ParsedHeader,
  lineNumber: number
): RawSimDuty | null {
  const date = parseDDMMYYYY(cols[header.columnIndices.date] || "");
  if (!date) return null;

  const dutyCell = (cols[header.columnIndices.duties] || "").trim();
  const detailCell = (cols[header.columnIndices.details] || "").trim();
  if (!dutyCell) return null;

  const dutyCode = dutyCell.split(/[\s\n]+/)[0];
  if (!isSimulatorDuty(dutyCode, detailCell)) return null;

  // The duty window ("06:15 - 10:15") can land in the report / actual columns
  // depending on the export — scan the whole row for the first HH:MM range.
  const joined = cols.join(" ");
  const range = joined.match(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);

  return {
    date,
    dutyCode,
    description: detailCell,
    startLocal: range?.[1],
    endLocal: range?.[2],
    sourceLine: lineNumber,
  };
}

// ============================================================
// Currency parsing
// ============================================================

function parseCurrencies(
  rows: NormalizedRow[],
  startIndex: number
): Omit<Currency, "id" | "createdAt" | "syncStatus">[] {
  const currencies: Omit<Currency, "id" | "createdAt" | "syncStatus">[] = [];

  for (let i = startIndex; i < rows.length; i++) {
    const line = rows[i].raw.trim();
    if (!line || line.startsWith("Training") || line.startsWith("Memos")) break;

    const cols = rows[i].cells;
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
  doc: NormalizedDocument,
  options: ParseOptions = {}
): Promise<PlannedImport> {
  const { onProgress } = options;

  const plan: PlannedImport = {
    success: false,
    timeReference: "UTC",
    dateRange: { start: "", end: "" },
    generatedAt: null,
    crewMember: { crewId: "", name: "", base: "", role: "", aircraftType: "" },
    operations: [],
    simSessions: [],
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
    plan.generatedAt = parseGeneratedAt(doc.rawText);
    if (plan.generatedAt === null) {
      plan.warnings.push({
        line: 0,
        message:
          "Could not find a 'Generated on' footer — stale-report protection is disabled for this import.",
      });
    }
    const header = parseHeader(doc.rows);
    plan.timeReference = header.timeReference;
    plan.dateRange = header.dateRange;
    plan.crewMember = header.crewInfo;

    // PDF rows arrive one-per-Y-bucket; regroup them so each table entry is
    // a single row whose multi-line cells match the CSV format. No-op for
    // CSV (rows have no Y).
    const rowsForParse = mergePdfTableRows(doc.rows, header);

    onProgress?.(10, "Validating", "Checking user profile...");
    // The user's PICUS-vs-SIC convention, so a PF/PM change can carry the
    // matching pilotRole correction.
    const storedPrefs = await getUserPreferences().catch(() => null);
    const importDefaults: ImportDefaults = {
      ...DEFAULT_IMPORT_DEFAULTS,
      ...(storedPrefs?.importDefaults ?? {}),
    };
    const currentUser = await getCurrentUserPersonnel();
    if (!currentUser) {
      throw new Error(
        "No user profile found. Please create a crew member with 'This is me' enabled."
      );
    }

    // Base airport TZ (required for LOCAL_BASE; informational otherwise)
    const baseAirport = await getAirportByIata(header.crewInfo.base);
    const baseTz = baseAirport?.tz;

    // Airport lookup with in-import cache. Carries ICAO through so the
    // sector record can render airport codes per the user's display
    // preference without a second lookup downstream.
    const airportCache = new Map<
      string,
      { tz: string; icao?: string } | undefined
    >();
    const lookupAirport = async (
      iata: string
    ): Promise<{ tz: string; icao?: string } | undefined> => {
      if (airportCache.has(iata)) return airportCache.get(iata);
      const a = await getAirportByIata(iata);
      const entry = a?.tz ? { tz: a.tz, icao: a.icao } : undefined;
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
    const rawSimDuties: RawSimDuty[] = [];
    const currencyStartMarker = "Code,,,Description";
    let currencyStartIdx = -1;

    for (let i = header.dataStartIndex; i < rowsForParse.length; i++) {
      const { raw, cells } = rowsForParse[i];
      if (raw.includes(currencyStartMarker)) {
        currencyStartIdx = i + 1;
        break;
      }
      if (!raw.trim() || raw.startsWith("Total Hours")) continue;

      const cols = cells;
      const duties = cols[header.columnIndices.duties] || "";
      if (!duties.match(/\d+\s*\[/)) {
        // Not a flight — capture simulator / training duty rows (EBT etc.).
        const sim = tryExtractSimDuty(cols, header, i + 1);
        if (sim) rawSimDuties.push(sim);
        continue;
      }

      try {
        const sectors = extractSectorsFromRow(cols, header, i + 1);

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

    // Pre-enrich airports referenced by the parsed sectors so the per-sector
    // `lookupAirport` calls in Stage B hit local IndexedDB. Missing IATAs go
    // through the same chain as logbook imports: MongoDB cache → FR24 →
    // write back. Also hydrates the user's home base airport.
    const uniqueIatasForEnrich = new Set<string>()
    if (header.crewInfo?.base) uniqueIatasForEnrich.add(header.crewInfo.base.toUpperCase())
    for (const s of rawSectors) {
      if (s.departureIata) uniqueIatasForEnrich.add(s.departureIata.toUpperCase())
      if (s.arrivalIata) uniqueIatasForEnrich.add(s.arrivalIata.toUpperCase())
    }
    if (uniqueIatasForEnrich.size > 0) {
      onProgress?.(45, "Resolving airports", `${uniqueIatasForEnrich.size} unique codes...`)
      await enrichAirportBatch(
        Array.from(uniqueIatasForEnrich),
        ({ current, total, code }) => {
          const pct = 45 + Math.floor((current / total) * 5)
          onProgress?.(pct, "Resolving airports", `${current}/${total}: ${code}`)
        }
      )
      // The in-import airportCache inside lookupAirport will pick up the
      // newly-written records on its next call — no need to invalidate it
      // because it hasn't been populated yet (Stage B hasn't started).
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
    // Flights in the recycle bin are not "existing" as far as a report is
    // concerned — matching one would silently update, and so resurrect, a
    // flight the user deleted.
    const flightsInRange = allFlights.filter(
      (f: FlightLog) =>
        isLiveFlight(f) && f.date >= rangeStart && f.date <= rangeEnd
    );

    const operations = reconcileRoster({
      sectors: parsedSectors,
      existingFlights: flightsInRange,
      csvDateRange: { start: rangeStart, end: rangeEnd },
      reportGeneratedAt: plan.generatedAt,
      reportSource: "schedule",
      scheduleGeneratedAt: plan.generatedAt,
      currentUser: { id: currentUser.id, crewId: currentUser.crewId },
      nonPicPfRole: importDefaults.nonPicPfRole,
      // Use the v2 safe/consult split so crew-only changes (incl. the
      // truncated→full name upgrade) auto-apply, while time/route changes on
      // already-flown flights still ask for confirmation.
      useLegacyUpdateConflict: false,
    });

    // Apply default acceptance flags + summary counts (shared helpers).
    plan.operations = applyDefaultAcceptance(operations);
    plan.summary = summarizeOperations(plan.operations);

    // Simulator / training sessions — duty rows enriched from the report's
    // "Training Details" section (times, course, facility, instructor). Times
    // are converted from the report's Local Base reference to UTC.
    onProgress?.(88, "Parsing", "Reading simulator sessions...");
    if (rawSimDuties.length > 0) {
      // Sims run at the home base facility; Local Base / Local Station times
      // convert to UTC via the base offset. A UTC report needs no shift.
      const baseOffset =
        header.timeReference === "UTC"
          ? 0
          : baseTz
            ? getAirportTimeInfo(baseTz).offset
            : 0;
      const trainingByDate = parseTrainingDetails(doc.rawText);

      const shiftToUtc = (hhmm?: string): string | undefined => {
        if (!hhmm) return undefined;
        const [h, m] = hhmm.split(":").map(Number);
        if (Number.isNaN(h) || Number.isNaN(m)) return undefined;
        let total = h * 60 + m - Math.round(baseOffset * 60);
        total = ((total % 1440) + 1440) % 1440;
        return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(
          total % 60
        ).padStart(2, "0")}`;
      };
      const durationHHMM = (start?: string, end?: string): string => {
        if (!start || !end) return "00:00";
        const [sh, sm] = start.split(":").map(Number);
        const [eh, em] = end.split(":").map(Number);
        if ([sh, sm, eh, em].some(Number.isNaN)) return "00:00";
        let diff = eh * 60 + em - (sh * 60 + sm);
        if (diff < 0) diff += 1440;
        return `${String(Math.floor(diff / 60)).padStart(2, "0")}:${String(
          diff % 60
        ).padStart(2, "0")}`;
      };

      for (const sim of rawSimDuties) {
        const td = trainingByDate.get(sim.date);
        const startLocal = td?.startLocal ?? sim.startLocal;
        const endLocal = td?.endLocal ?? sim.endLocal;
        plan.simSessions.push({
          date: sim.date,
          duration: durationHHMM(startLocal, endLocal),
          deviceType:
            td?.deviceType ||
            normalizeAircraftType(header.crewInfo.aircraftType) ||
            "SIM",
          sessionCode: sim.dutyCode || td?.component || "SIM",
          remarks: sim.description || "",
          sourceLine: sim.sourceLine,
          outUtc: shiftToUtc(startLocal),
          inUtc: shiftToUtc(endLocal),
          courseName: td?.courseName,
          component: td?.component,
          facility: td?.facility,
          instructorName: td?.instructorName,
        });
      }
    }

    // Currencies
    onProgress?.(90, "Parsing", "Reading currency dates...");
    if (currencyStartIdx > 0) {
      plan.currencies = parseCurrencies(rowsForParse, currencyStartIdx);
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

