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
import { getCurrentUserPersonnel, getAirportByIata, getAllPersonnel } from "@/lib/db";
import { calculateNightTimeComplete } from "@/lib/utils/night-time";
import {
  isTakeoffAtNight,
  isLandingAtNight,
} from "@/lib/utils/flight-calculations";
import { hhmmToMinutes, minutesToHHMM } from "@/lib/utils/time";

import { splitCsvRows, parseCSVLine, parseDDMMYY } from "./shared/csv-split";
import { normalize } from "./shared/name-normalize";
import { parseGeneratedAt } from "./shared/generated-at";
import { normalizeAircraftType } from "./shared/aircraft-type-map";
import {
  enrichAircraftBatch,
  type EnrichResult,
} from "./shared/aircraft-enricher";
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
  remarks: string;
  /** Source CSV/PDF line for diagnostics. */
  sourceLine: number;
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

function parseRawRow(line: string, lineNumber: number): RawRow | null {
  const cols = parseCSVLine(line);
  const rawDate = cols[0]?.trim() || "";
  if (!DATE_RE.test(rawDate)) return null;

  const flightDate = parseDDMMYY(rawDate);
  if (!flightDate) return null;

  return {
    cols,
    flightDate,
    rawDate,
    depIata: (cols[1] || "").trim().toUpperCase(),
    arrIata: (cols[3] || "").trim().toUpperCase(),
    rawReg: (cols[6] || "").trim().toUpperCase(),
    outT: (cols[2] || "").trim(),
    inT: (cols[4] || "").trim(),
    blockT: (cols[7] || "").trim(),
    aircraftType: (cols[5] || "").trim(),
    picRawName: (cols[8] || "").trim(),
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
  text: string,
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

    plan.generatedAt = parseGeneratedAt(text);
    if (plan.generatedAt === null) {
      plan.warnings.push({
        line: 0,
        message:
          "Could not find a 'Generated on' footer — stale-report protection is disabled for this import.",
      });
    }

    const lines = splitCsvRows(text);
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

    for (let i = dataStart; i < lines.length; i++) {
      const line = lines[i].trim();
      if (
        !line ||
        line.startsWith("Totals") ||
        line.startsWith(",") ||
        line.startsWith("\"Generated on")
      ) {
        continue;
      }

      const row = parseRawRow(line, i + 1);
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

    // Airports — local lookup is cheap, do all in parallel.
    const airportEntries = await Promise.all(
      Array.from(uniqueIatas).map(async (iata) => {
        const a = await getAirportByIata(iata);
        return [iata, a] as const;
      })
    );
    const airportMap = new Map(airportEntries);

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
          plan.simSessions.push({
            date: row.flightDate,
            duration: row.synthTime || row.blockT || "00:00",
            deviceType: row.aircraftType || "SIM",
            sessionCode: row.remarks || row.synthType || "SIM",
            remarks: row.remarks || "",
            sourceLine: row.sourceLine,
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

        const depAp = airportMap.get(row.depIata);
        const arrAp = airportMap.get(row.arrIata);

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

        // We don't compute night time here — the executor will run
        // recalculateFlightFields() once all derived inputs are known.
        // But we do compute it best-effort so the plan view shows real values.
        const nightTime =
          depAp && arrAp && row.outT && row.inT
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
        const isPilotFlying = totalUserTO + totalUserLDG > 0;

        // Sun-position sanity check — both CSV and PDF are hand-entered in
        // eCrew, so the day/night column is the most common manual-entry
        // mistake we see. We DON'T silently override here; we compute the
        // sun-based suggestion and surface it to the user via the diff so
        // they can choose. The user's decision is then persisted in remarks
        // (see executor) so subsequent imports don't re-flag the same row.
        let suggestedDayTakeoffs: number | undefined;
        let suggestedNightTakeoffs: number | undefined;
        let suggestedDayLandings: number | undefined;
        let suggestedNightLandings: number | undefined;

        if (depAp && arrAp && row.outT && row.inT) {
          if (totalUserTO > 0) {
            const takeoffAtNight = isTakeoffAtNight(
              row.flightDate,
              row.outT,
              depAp
            );
            const sunDay = takeoffAtNight ? 0 : totalUserTO;
            const sunNight = takeoffAtNight ? totalUserTO : 0;
            if (sunDay !== row.dayTakeoffs || sunNight !== row.nightTakeoffs) {
              suggestedDayTakeoffs = sunDay;
              suggestedNightTakeoffs = sunNight;
            }
          }
          if (totalUserLDG > 0) {
            const landingAtNight = isLandingAtNight(
              row.flightDate,
              row.outT,
              row.inT,
              arrAp
            );
            const sunDay = landingAtNight ? 0 : totalUserLDG;
            const sunNight = landingAtNight ? totalUserLDG : 0;
            if (sunDay !== row.dayLandings || sunNight !== row.nightLandings) {
              suggestedDayLandings = sunDay;
              suggestedNightLandings = sunNight;
            }
          }
        }

        plan.sectors.push({
          date: row.flightDate,
          aircraftReg: matchedAc?.registration || row.rawReg,
          aircraftType,
          departureIata: row.depIata,
          arrivalIata: row.arrIata,
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
          suggestedDayTakeoffs,
          suggestedNightTakeoffs,
          suggestedDayLandings,
          suggestedNightLandings,
          isPilotFlying,
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
