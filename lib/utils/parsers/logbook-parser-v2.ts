/**
 * Crew Logbook Report parser — v2.
 *
 * Replaces scoot-parser.ts. Emits a `PlannedLogbookImport` describing what
 * WOULD happen — no DB writes occur here. The unified import flow runs the
 * plan through the reconciler + executor (same architecture as the schedule
 * parser).
 *
 * Differences vs the old parser:
 *  - No direct DB writes. Caller owns persistence.
 *  - Aircraft enrichment is run in parallel via the shared
 *    aircraft-enricher chain (local → server-batch → FR24 → write back).
 *  - PDF input is supported when callers extract text up front
 *    (see `ingest.ts`).
 *  - "Generated on" footer is parsed and surfaced so the reconciler can
 *    reject older reports from regressing newer data.
 *  - Sim sessions (no aircraft reg, has SYNTH. DEVICES time) are routed to
 *    a separate `simSessions` array — never reconciled against flights.
 */

import type { Personnel } from "@/types/entities/crew.types";
import { getCurrentUserPersonnel, getAllPersonnel, getAirportTimeInfo } from "@/lib/db";
import { suggestToLdg, type ToLdgSuggestion } from "./shared/to-ldg-suggestion";
import {
  calculateNightTimeComplete,
  findDayBoundariesUtc,
} from "@/lib/utils/night-time";
import {
  isTakeoffAtNight,
  isLandingAtNight,
} from "@/lib/utils/flight-calculations";
import { hhmmToMinutes, minutesToHHMM } from "@/lib/utils/time";
import type { ParsedSector } from "@/lib/utils/roster/reconciler";

/**
 * Shift a UTC HH:MM string by an integer hour offset, wrapping into a
 * 0–24 hour window. Used purely for the diff-note display — no date
 * arithmetic, since the local-date drift is implicit in the offset sign.
 */
function shiftHHMM(hhmm: string, offsetHours: number): string {
  const minutes = hhmmToMinutes(hhmm);
  if (minutes < 0) return hhmm;
  const shifted = ((minutes + offsetHours * 60) % (24 * 60) + 24 * 60) % (24 * 60);
  return minutesToHHMM(shifted);
}

import { parseDDMMYY } from "./shared/csv-split";
import type { NormalizedDocument } from "./types";
import { normalize } from "./shared/name-normalize";
import { parseGeneratedAt, isPlannedDate } from "./shared/generated-at";
import { normalizeAircraftType } from "./shared/aircraft-type-map";
import {
  enrichAircraftBatch,
  type EnrichResult,
} from "./shared/aircraft-enricher";
import { codeConflictMessage, enrichAirportBatch } from "./shared/airport-enricher";
import { flightInstantMs, pickAirportAt } from "@/lib/airports/code-changes";
import { resolveCrewByName } from "./shared/crew-resolver";

// ============================================================
// Public types
// ============================================================

export interface ParsedLogbookSector {
  /** UTC YYYY-MM-DD (logbook is already UTC). */
  date: string;
  /** Optional — logbook usually doesn't carry the flight number. */
  flightNumber?: string;
  aircraftReg: string;
  /** ICAO type code as written ("32N", "32Q", "320"). */
  aircraftType: string;
  departureIata: string;
  arrivalIata: string;
  /**
   * ICAO codes resolved during airport enrichment. Carried so downstream UI
   * can honour the user's ICAO/IATA display preference — without these a
   * logbook-sourced sector could only ever render IATA.
   */
  departureIcao?: string;
  arrivalIcao?: string;
  /** UTC HH:MM. */
  outTime: string;
  inTime: string;
  blockTime: string;
  /** Up to 20 chars — logbook truncates. Empty when blank. */
  picRawName: string;
  /** Resolved against current user's name (case-insensitive normalized). */
  isUserPic: boolean;
  /** Resolved Personnel id (lookup or freshly created). */
  picPersonnelId: string;
  /** Full name when truncation could be upgraded against existing crew. */
  picResolvedName: string;
  dayTakeoffs: number;
  nightTakeoffs: number;
  dayLandings: number;
  nightLandings: number;
  /**
   * Inferred from the logbook's TO/LDG columns: any takeoff or landing
   * recorded for the user means they were the Pilot Flying for the leg.
   * Zero TO/LDG means they were the Pilot Monitoring.
   */
  isPilotFlying: boolean;
  /**
   * Sun-position-derived TO/LDG suggestion + day/night cutoff context.
   * Populated only when it differs from the hand-entered value, so the
   * reconciler can annotate the diff and the modal can show the day/night
   * check. Mirrors the optional fields on ParsedSector.
   */
  suggestedDayTakeoffs?: number;
  suggestedNightTakeoffs?: number;
  suggestedDayLandings?: number;
  suggestedNightLandings?: number;
  toLdgContext?: ParsedSector["toLdgContext"];
  remarks: string;
  /** Source CSV/PDF line for diagnostics. */
  sourceLine: number;
  /**
   * True when the row is dated after the report's generation date — a planned
   * roster sector, NOT a flown flight. The times are scheduled (not actual),
   * there are no takeoff/landing counts, and pilot-flying is unknown. The
   * sector→ParsedSector mapper routes these to scheduledOut/In accordingly.
   */
  planned: boolean;
}

export interface ParsedSimSession {
  /** UTC YYYY-MM-DD. */
  date: string;
  /** Synth-device duration in HH:MM. */
  duration: string;
  /** Device type code (e.g., "318"). */
  deviceType: string;
  /** Free-text session label (e.g., "EBT1"). */
  sessionCode: string;
  remarks: string;
  sourceLine: number;
  // ---- Optional enrichment from a schedule report's Training Details ----
  /** UTC HH:MM session start (normalized from the report's time reference). */
  outUtc?: string;
  /** UTC HH:MM session end. */
  inUtc?: string;
  /** Course name, e.g. "*A320 EBT Cycle6 (May 14)". */
  courseName?: string;
  /** Course component, e.g. "SMCK EBT6 D1". */
  component?: string;
  /** Facility name, e.g. "AATC SIM B". */
  facility?: string;
  /** Instructor full name when resolvable. */
  instructorName?: string;
}

export interface PlannedLogbookImport {
  success: boolean;
  /** Range from the CSV header line. */
  dateRange: { start: string; end: string };
  /** "Generated on..." footer time, epoch ms. null when absent. */
  generatedAt: number | null;
  sectors: ParsedLogbookSector[];
  simSessions: ParsedSimSession[];
  /** Raw registrations seen in CSV (uppercased, trimmed). */
  uniqueRegistrations: string[];
  /** Registrations the enrichment chain could not resolve. */
  unmatchedRegistrations: string[];
  /** Aircraft enrichment stats — surfaced in import summary. */
  aircraftStats: EnrichResult["stats"];
  /** New Personnel rows discovered while resolving truncated PIC names. */
  personnelToCreate: Personnel[];
  errors: Array<{ line: number; message: string; raw?: string }>;
  warnings: Array<{ line: number; message: string }>;
}

export interface ParseLogbookOptions {
  onProgress?: (percent: number, stage: string, detail?: string) => void;
  /** Skip aircraft enrichment for tests / fast-path. */
  skipEnrichment?: boolean;
}

// ============================================================
// Helpers
// ============================================================

interface RawRow {
  cols: string[];
  flightDate: string;
  rawDate: string;
  depIata: string;
  arrIata: string;
  rawReg: string;
  outT: string;
  inT: string;
  blockT: string;
  aircraftType: string;
  picRawName: string;
  dayTakeoffs: number;
  nightTakeoffs: number;
  dayLandings: number;
  nightLandings: number;
  synthTime: string;
  synthType: string;
  remarks: string;
  sourceLine: number;
}

const DATE_RE = /^\d{2}\/\d{2}\/\d{2}$/;

function findHeaderIndex(lines: string[]): number {
  return lines.findIndex(
    (l) => l.includes("Date,Airport,Time") || l.includes("Date,Airport")
  );
}

function findRangeFromHeader(lines: string[]): { start: string; end: string } {
  for (const line of lines.slice(0, 6)) {
    const match = line.match(
      /(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})/
    );
    if (match) {
      // DD/MM/YYYY → YYYY-MM-DD
      const toIso = (d: string) => {
        const [dd, mm, yyyy] = d.split("/");
        return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
      };
      return { start: toIso(match[1]), end: toIso(match[2]) };
    }
  }
  return { start: "", end: "" };
}

/**
 * The Flt-time cell sometimes arrives as "HH:MM <PIC name>".
 *
 * The PDF renderer emits the flight-time value and the adjacent Name-PIC value
 * as a single text run, which the column snapper then assigns wholesale to the
 * Flt-time column — corrupting the block time (the name showed up in the review
 * modal's `blockTime → …` diff) and leaving the PIC-name column empty. Split it
 * back: the leading HH:MM is the block time; any trailing text is the PIC name.
 */
export function splitFltTimeCell(cell: string): {
  blockTime: string;
  bleedName: string;
} {
  const raw = (cell || "").trim();
  const m = raw.match(/^(\d{1,2}:\d{2})(?:\s+(.+))?$/);
  if (!m) return { blockTime: raw, bleedName: "" };
  return {
    blockTime: m[1].padStart(5, "0"),
    bleedName: (m[2] || "").trim(),
  };
}

function parseRawRow(cols: string[], lineNumber: number): RawRow | null {
  const rawDate = cols[0]?.trim() || "";
  if (!DATE_RE.test(rawDate)) return null;

  const flightDate = parseDDMMYY(rawDate);
  if (!flightDate) return null;

  // Recover a PIC name that bled into the Flt-time cell (see splitFltTimeCell).
  const { blockTime, bleedName } = splitFltTimeCell(cols[7] || "");
  const picFromColumn = (cols[8] || "").trim();
  const picRawName = picFromColumn || bleedName;

  return {
    cols,
    flightDate,
    rawDate,
    depIata: (cols[1] || "").trim().toUpperCase(),
    arrIata: (cols[3] || "").trim().toUpperCase(),
    rawReg: (cols[6] || "").trim().toUpperCase(),
    outT: (cols[2] || "").trim(),
    inT: (cols[4] || "").trim(),
    blockT: blockTime,
    aircraftType: (cols[5] || "").trim(),
    picRawName,
    dayTakeoffs: parseInt(cols[9] || "", 10) || 0,
    nightTakeoffs: parseInt(cols[10] || "", 10) || 0,
    dayLandings: parseInt(cols[11] || "", 10) || 0,
    nightLandings: parseInt(cols[12] || "", 10) || 0,
    synthTime: (cols[16] || "").trim(),
    synthType: (cols[17] || "").trim(),
    remarks: (cols[17] || "").trim(),
    sourceLine: lineNumber,
  };
}

function isSimRow(row: RawRow): boolean {
  // No aircraft registration AND either an explicit synth-time value or a
  // device-type column matching a known sim code (e.g., "318").
  if (row.rawReg) return false;
  if (row.synthTime && row.synthTime !== "" && row.synthTime !== "00:00") {
    return true;
  }
  if (
    !row.depIata &&
    !row.arrIata &&
    row.aircraftType &&
    /^31\d|^32\d|^33\d|^77\d/.test(row.aircraftType) === false
  ) {
    return true;
  }
  return false;
}

// ============================================================
// Main entry
// ============================================================

export async function parseLogbookV2(
  doc: NormalizedDocument,
  options: ParseLogbookOptions = {}
): Promise<PlannedLogbookImport> {
  const { onProgress } = options;
  const plan: PlannedLogbookImport = {
    success: false,
    dateRange: { start: "", end: "" },
    generatedAt: null,
    sectors: [],
    simSessions: [],
    uniqueRegistrations: [],
    unmatchedRegistrations: [],
    aircraftStats: { localHits: 0, serverBatchHits: 0, fr24Hits: 0, failed: 0 },
    personnelToCreate: [],
    errors: [],
    warnings: [],
  };

  try {
    onProgress?.(5, "Parsing", "Reading file...");

    plan.generatedAt = parseGeneratedAt(doc.rawText);
    if (plan.generatedAt === null) {
      plan.warnings.push({
        line: 0,
        message:
          "Could not find a 'Generated on' footer — stale-report protection is disabled for this import.",
      });
    }

    const lines = doc.rows.map((r) => r.raw);
    const headerIdx = findHeaderIndex(lines);
    if (headerIdx === -1) {
      plan.errors.push({
        line: 0,
        message: "Invalid file format — header row 'Date,Airport,Time' not found.",
      });
      return plan;
    }

    plan.dateRange = findRangeFromHeader(lines);

    const currentUser = await getCurrentUserPersonnel();
    if (!currentUser) {
      plan.errors.push({
        line: 0,
        message:
          "No user profile found. Create a crew member with 'This is me' enabled first.",
      });
      return plan;
    }

    const dataStart = headerIdx + 1;
    const rawRows: RawRow[] = [];
    const uniqueIatas = new Set<string>();
    const uniqueRegs = new Set<string>();

    for (let i = dataStart; i < doc.rows.length; i++) {
      const line = lines[i].trim();
      if (
        !line ||
        line.startsWith("Totals") ||
        line.startsWith(",") ||
        line.startsWith("\"Generated on")
      ) {
        continue;
      }

      const row = parseRawRow(doc.rows[i].cells, i + 1);
      if (!row) continue;

      if (row.depIata && row.depIata.length === 3) uniqueIatas.add(row.depIata);
      if (row.arrIata && row.arrIata.length === 3) uniqueIatas.add(row.arrIata);
      if (row.rawReg) uniqueRegs.add(row.rawReg);

      rawRows.push(row);
    }

    plan.uniqueRegistrations = Array.from(uniqueRegs);

    if (rawRows.length === 0) {
      plan.errors.push({
        line: 0,
        message: "No valid flight rows found in the file.",
      });
      return plan;
    }

    onProgress?.(20, "Loading", "Resolving airports + aircraft...");

    // Airports — enrichment chain: local IDB → MongoDB cache → FR24.
    // Hydrates any airports missing from the user's local DB before the
    // sector loop runs, so timezone/coords are available for every IATA.
    const airportEnrich = await enrichAirportBatch(
      Array.from(uniqueIatas),
      ({ current, total, code }) => {
        const pct = 20 + Math.floor((current / total) * 5);
        onProgress?.(pct, "Resolving airports", `${current}/${total}: ${code}`);
      }
    );
    for (const conflict of airportEnrich?.codeConflicts ?? []) {
      plan.warnings.push({ line: 0, message: codeConflictMessage(conflict) });
    }

    // Aircraft enrichment chain.
    let enrichResult: EnrichResult = {
      enriched: new Map(),
      failedRegs: [],
      stats: { localHits: 0, serverBatchHits: 0, fr24Hits: 0, failed: 0 },
    };
    if (!options.skipEnrichment && uniqueRegs.size > 0) {
      enrichResult = await enrichAircraftBatch(
        Array.from(uniqueRegs),
        ({ current, total, reg }) => {
          const pct = 25 + Math.floor((current / total) * 25);
          onProgress?.(pct, "Enriching aircraft", `${current}/${total}: ${reg}`);
        }
      );
    }
    plan.aircraftStats = enrichResult.stats;
    plan.unmatchedRegistrations = enrichResult.failedRegs;

    onProgress?.(60, "Resolving crew", "Matching PIC names against personnel...");

    const existingCrew = await getAllPersonnel();
    const crewCache = new Map<string, string>();
    for (const p of existingCrew) {
      const norm = normalize(p.name);
      if (norm) crewCache.set(norm, p.id);
    }

    const newPersonnel: Personnel[] = [];

    onProgress?.(70, "Building", "Building flight records...");

    for (const row of rawRows) {
      try {
        if (isSimRow(row)) {
          // The logbook is already UTC, so the row's dep/arr times are the
          // sim session's UTC window.
          plan.simSessions.push({
            date: row.flightDate,
            duration: row.synthTime || row.blockT || "00:00",
            deviceType: row.aircraftType || "SIM",
            sessionCode: row.remarks || row.synthType || "SIM",
            remarks: row.remarks || "",
            sourceLine: row.sourceLine,
            outUtc: row.outT || undefined,
            inUtc: row.inT || undefined,
          });
          continue;
        }

        if (!row.depIata || !row.arrIata) {
          plan.warnings.push({
            line: row.sourceLine,
            message: `Row missing departure or arrival airport — skipped`,
          });
          continue;
        }

        // A code names the airport it meant WHEN the sector flew (VTZ moved
        // from VOVZ to VOVI on 17 Aug 2026). The logbook's times are UTC.
        const depAt = flightInstantMs(row.flightDate, row.outT);
        const arrAt = flightInstantMs(row.flightDate, row.inT, row.outT);
        const depAp = pickAirportAt(airportEnrich.enriched, row.depIata, depAt);
        const arrAp = pickAirportAt(airportEnrich.enriched, row.arrIata, arrAt);

        if (!depAp || !arrAp) {
          plan.warnings.push({
            line: row.sourceLine,
            message: `Unknown airport ${!depAp ? row.depIata : ""}${
              !depAp && !arrAp ? " and " : ""
            }${!arrAp ? row.arrIata : ""}`,
          });
        }

        const matchedAc = enrichResult.enriched.get(row.rawReg);
        // Prefer the ICAO designator from the local/FR24 enrichment (already
        // canonical). Fall back to the carrier-specific code from the CSV
        // and normalize "32Q"/"32N"/"320" → "A21N"/"A20N"/"A320".
        const aircraftType = normalizeAircraftType(
          matchedAc?.typecode || row.aircraftType
        );

        const crew = resolveCrewByName(row.picRawName, {
          existingCrew,
          crewCache,
          currentUserName: currentUser.name,
          currentUserId: currentUser.id,
          newPersonnel,
        });

        // Rows dated after the report's generation are PLANNED roster sectors,
        // not flown flights. Their times are scheduled — we must not hydrate
        // them as actual out/in/block/pilot-flying, and the expensive sun /
        // night computation below is skipped (no actuals to classify).
        const planned = isPlannedDate(row.flightDate, plan.generatedAt);

        // We don't compute night time here — the executor will run
        // recalculateFlightFields() once all derived inputs are known.
        // But we do compute it best-effort so the plan view shows real values.
        const nightTime =
          !planned && depAp && arrAp && row.outT && row.inT
            ? calculateNightTimeComplete(
                row.flightDate,
                row.outT,
                "",
                "",
                row.inT,
                { lat: depAp.latitude, lon: depAp.longitude },
                { lat: arrAp.latitude, lon: arrAp.longitude }
              ).nightTimeHHMM
            : "00:00";

        const dayTime = minutesToHHMM(
          Math.max(
            0,
            hhmmToMinutes(row.blockT || "00:00") - hhmmToMinutes(nightTime)
          )
        );
        // dayTime is computed for completeness even though the parser doesn't
        // emit it directly — recalculateFlightFields() at executor time will
        // recompute. Reference here keeps lint clean.
        void dayTime;

        // The logbook's TO/LDG columns refer to the LOGGED user (the report
        // subject). Any takeoff or landing recorded → user was Pilot Flying.
        // No TO/LDG → user was Pilot Monitoring. This is independent of the
        // PIC role (the user may be PF as SIC, or PM as PIC).
        const totalUserTO = row.dayTakeoffs + row.nightTakeoffs;
        const totalUserLDG = row.dayLandings + row.nightLandings;
        // Planned sectors have no actuals, so pilot-flying is unknown.
        const isPilotFlying = !planned && totalUserTO + totalUserLDG > 0;

        // Sun-position check — both CSV and PDF are hand-entered in eCrew,
        // and the day/night columns disagree with the sun on about a third of
        // a real year's sectors (the sun at −78° marked "day", at +35°
        // "night"). The sun's answer is what gets applied, to a create and an
        // update alike; the report's figure travels with it so the review can
        // show the disagreement and the pilot can still take the company's.
        let suggestion: ToLdgSuggestion = {};
        let toLdgContext: ParsedSector["toLdgContext"] | undefined;

        if (!planned && depAp && arrAp && row.outT && row.inT) {
          // The offset at the time of the flight, not today's — a zone that
          // keeps summer time answers differently in July and January.
          const depOffset = getAirportTimeInfo(depAp.tz, new Date(depAt ?? Date.now())).offset;
          const arrOffset = getAirportTimeInfo(arrAp.tz, new Date(arrAt ?? Date.now())).offset;
          const takeoffAtNight = isTakeoffAtNight(
            row.flightDate,
            row.outT,
            depAp
          );
          const landingAtNight = isLandingAtNight(
            row.flightDate,
            row.outT,
            row.inT,
            arrAp
          );

          suggestion = suggestToLdg(row, isPilotFlying, takeoffAtNight, landingAtNight);

          const depBounds = findDayBoundariesUtc(
            row.flightDate,
            depAp.latitude,
            depAp.longitude
          );
          const arrBounds = findDayBoundariesUtc(
            row.flightDate,
            arrAp.latitude,
            arrAp.longitude
          );

          toLdgContext = {
            outUtc: row.outT,
            inUtc: row.inT,
            depLocal: shiftHHMM(row.outT, depOffset),
            depTzOffset: depOffset,
            depSunStatus: takeoffAtNight ? "night" : "day",
            depSunriseUtc: depBounds.sunriseUtc,
            depSunsetUtc: depBounds.sunsetUtc,
            arrLocal: shiftHHMM(row.inT, arrOffset),
            arrTzOffset: arrOffset,
            arrSunStatus: landingAtNight ? "night" : "day",
            arrSunriseUtc: arrBounds.sunriseUtc,
            arrSunsetUtc: arrBounds.sunsetUtc,
          };
        }

        plan.sectors.push({
          date: row.flightDate,
          aircraftReg: matchedAc?.registration || row.rawReg,
          aircraftType,
          departureIata: row.depIata,
          arrivalIata: row.arrIata,
          departureIcao: depAp?.icao,
          arrivalIcao: arrAp?.icao,
          outTime: row.outT,
          inTime: row.inT,
          blockTime: row.blockT || "00:00",
          picRawName: row.picRawName,
          isUserPic: crew.isUser,
          picPersonnelId: crew.personnelId,
          picResolvedName: crew.resolvedName,
          // PDF/CSV values as-entered. The sun-based suggestion travels
          // alongside as `suggested*` so the reconciler can annotate the
          // diff without silently rewriting the values.
          dayTakeoffs: row.dayTakeoffs,
          nightTakeoffs: row.nightTakeoffs,
          dayLandings: row.dayLandings,
          nightLandings: row.nightLandings,
          ...suggestion,
          toLdgContext,
          isPilotFlying,
          planned,
          remarks: row.remarks,
          sourceLine: row.sourceLine,
        });
      } catch (error) {
        plan.errors.push({
          line: row.sourceLine,
          message:
            error instanceof Error ? error.message : "Failed to parse row",
        });
      }
    }

    plan.personnelToCreate = newPersonnel;
    plan.success = plan.errors.length === 0;
    onProgress?.(100, "Ready", `${plan.sectors.length} flights parsed`);
  } catch (error) {
    plan.errors.push({
      line: 0,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    plan.success = false;
  }

  return plan;
}
