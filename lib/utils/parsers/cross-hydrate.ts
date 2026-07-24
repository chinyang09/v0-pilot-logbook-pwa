/**
 * Cross-hydration — merge a Crew Logbook plan and a Schedule plan into a
 * single unified set of `ParsedSector` rows the reconciler can consume.
 *
 * Logbook is authoritative for: aircraft registration, actual times, day/
 * night TO/LDG, block time, remarks. Schedule is authoritative for: full
 * crew names + IDs, flight numbers, scheduled times, and aircraft subtype
 * (e.g., "32N" vs the family code "320" the logbook uses).
 *
 * Matching key (UTC):
 *   `${date}|${depIata}|${arrIata}|${aircraftFamily}`
 * Tiebreaker: minimum |logbookOut − scheduleOut| within 90 minutes.
 */

import { hhmmToMinutes } from "@/lib/utils/time";
import { normalize } from "./shared/name-normalize";
import {
  familyOfNormalizedType,
  normalizeAircraftType,
} from "./shared/aircraft-type-map";
import type { ParsedSector } from "@/lib/utils/roster/reconciler";
import type {
  PlannedLogbookImport,
  ParsedLogbookSector,
} from "./logbook-parser-v2";
import type { PlannedImport } from "./schedule-parser";
import type {
  ScheduledCrewMember,
} from "@/types/entities/roster.types";

// Preferred time window for disambiguating MULTIPLE same-route legs on one
// day. It is a preference, not a hard cutoff: when only one schedule sector
// shares a logbook sector's full key (date|dep|arr|family) we bind them even
// if the delay exceeds this, because leaving both unmatched makes the
// reconciler create TWO flights for one leg (the duplicate-flight bug).
const MATCH_WINDOW_MIN = 90;

function familyOf(typeCode: string): string {
  return familyOfNormalizedType(normalizeAircraftType(typeCode));
}

function keyFor(
  date: string,
  depIata: string,
  arrIata: string,
  type: string
): string {
  return `${date}|${depIata}|${arrIata}|${familyOf(type)}`;
}

export interface CrossHydrateResult {
  /** Merged sectors ready for the reconciler. */
  sectors: ParsedSector[];
  /** Logbook rows with no schedule match — they pass through enriched only with what the logbook had. */
  unmatchedLogbook: ParsedLogbookSector[];
  /** Schedule sectors with no logbook match — pass through unchanged. */
  unmatchedSchedule: ParsedSector[];
}

interface ScheduleSectorWithIndex {
  sector: ParsedSector;
  index: number;
}

function pickScheduleMatch(
  log: ParsedLogbookSector,
  pool: ScheduleSectorWithIndex[]
): ScheduleSectorWithIndex | null {
  if (pool.length === 0) return null;

  // Single same-key candidate → it IS this leg (same date + route + family).
  // Bind it regardless of any delay so a >90-min delay doesn't spawn a
  // duplicate flight.
  if (pool.length === 1) return pool[0];

  const logOut = hhmmToMinutes(log.outTime || "00:00");
  let best: ScheduleSectorWithIndex | null = null;
  let bestDelta = Infinity;
  let bestWithinWindow: ScheduleSectorWithIndex | null = null;
  let bestWithinWindowDelta = Infinity;

  for (const entry of pool) {
    const sched = entry.sector;
    const cmpRaw = sched.actualOut || sched.scheduledOut || "00:00";
    const cmp = hhmmToMinutes(cmpRaw);
    const delta = Math.abs(cmp - logOut);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = entry;
    }
    if (delta <= MATCH_WINDOW_MIN && delta < bestWithinWindowDelta) {
      bestWithinWindowDelta = delta;
      bestWithinWindow = entry;
    }
  }
  // Prefer the closest within-window candidate when disambiguating multiple
  // legs; otherwise fall back to the overall closest so the leg still merges.
  return bestWithinWindow ?? best;
}

function mergeCrew(
  logSector: ParsedLogbookSector,
  scheduleCrew: ScheduledCrewMember[]
): ScheduledCrewMember[] {
  if (!scheduleCrew || scheduleCrew.length === 0) return [];

  // Schedule already has full names + crewIds — return as-is. The logbook's
  // truncated PIC name is replaced via `picName` selection in the executor.
  void logSector;
  return scheduleCrew;
}

/** The ParsedSector carried by a schedule op, if any (delete/skip_non_airline carry none). */
function sectorOf(
  op: PlannedImport["operations"][number]
): ParsedSector | undefined {
  switch (op.kind) {
    case "create":
    case "skip_identical":
    case "update_safe":
    case "update_consult":
    case "update_conflict":
    case "edited_conflict":
    case "skip_stale_report":
      return op.sector;
    default:
      return undefined;
  }
}

export function crossHydrate(
  logbook: PlannedLogbookImport,
  schedule: PlannedImport
): CrossHydrateResult {
  // Build an index of schedule sectors by match key (collisions kept as a list
  // so we can disambiguate by time).
  const scheduleIndex = new Map<string, ScheduleSectorWithIndex[]>();
  schedule.operations.forEach((op, i) => {
    // Every op EXCEPT delete_missing / skip_non_airline carries a ParsedSector
    // (create, skip_identical, and all four update kinds — update_safe,
    // update_consult, update_conflict, edited_conflict). Index them all so a
    // schedule leg that already matched a DB flight still merges with its
    // logbook counterpart instead of being dropped.
    const sector = sectorOf(op);
    if (!sector) return;
    const key = keyFor(
      sector.date,
      sector.departureIata,
      sector.arrivalIata,
      sector.aircraftType
    );
    const list = scheduleIndex.get(key) ?? [];
    list.push({ sector, index: i });
    scheduleIndex.set(key, list);
  });

  const usedScheduleIndices = new Set<number>();
  const merged: ParsedSector[] = [];
  const unmatchedLogbook: ParsedLogbookSector[] = [];

  for (const log of logbook.sectors) {
    const key = keyFor(log.date, log.departureIata, log.arrivalIata, log.aircraftType);
    const candidates = (scheduleIndex.get(key) ?? []).filter(
      (e) => !usedScheduleIndices.has(e.index)
    );
    const match = pickScheduleMatch(log, candidates);

    if (!match) {
      unmatchedLogbook.push(log);
      // Promote the logbook sector to a ParsedSector so the reconciler can
      // see it. We don't have schedule info, so flightNumber/crew stay empty.
      const csvFlightNumber = log.flightNumber ?? "";
      merged.push({
        date: log.date,
        flightNumber: csvFlightNumber,
        aircraftType: log.aircraftType,
        departureIata: log.departureIata,
        arrivalIata: log.arrivalIata,
        scheduledOut: undefined,
        scheduledIn: undefined,
        actualOut: log.outTime,
        actualIn: log.inTime,
        sourceLine: log.sourceLine,
        crew: undefined,
        // Carry logbook-only enrichment.
        aircraftReg: log.aircraftReg,
        dayTakeoffs: log.dayTakeoffs,
        nightTakeoffs: log.nightTakeoffs,
        dayLandings: log.dayLandings,
        nightLandings: log.nightLandings,
        blockTime: log.blockTime,
        picRawName: log.picRawName,
        isUserPic: log.isUserPic,
        picPersonnelId: log.picPersonnelId,
        picResolvedName: log.picResolvedName,
        isPilotFlying: log.isPilotFlying,
        suggestedDayTakeoffs: log.suggestedDayTakeoffs,
        suggestedNightTakeoffs: log.suggestedNightTakeoffs,
        suggestedDayLandings: log.suggestedDayLandings,
        suggestedNightLandings: log.suggestedNightLandings,
        toLdgContext: log.toLdgContext,
        remarks: log.remarks,
      } as ParsedSector & Record<string, unknown>);
      continue;
    }

    usedScheduleIndices.add(match.index);
    const sched = match.sector;

    // Prefer schedule's specific aircraft subtype ("32N") over logbook's family ("320").
    const mergedType =
      sched.aircraftType && sched.aircraftType.length === 3
        ? sched.aircraftType
        : log.aircraftType;

    merged.push({
      date: log.date,
      flightNumber: sched.flightNumber || log.flightNumber || "",
      aircraftType: mergedType,
      departureIata: log.departureIata,
      arrivalIata: log.arrivalIata,
      scheduledOut: sched.scheduledOut,
      scheduledIn: sched.scheduledIn,
      actualOut: log.outTime || sched.actualOut,
      actualIn: log.inTime || sched.actualIn,
      sourceLine: log.sourceLine,
      crew: mergeCrew(log, sched.crew ?? []),
      aircraftReg: log.aircraftReg,
      dayTakeoffs: log.dayTakeoffs,
      nightTakeoffs: log.nightTakeoffs,
      dayLandings: log.dayLandings,
      nightLandings: log.nightLandings,
      blockTime: log.blockTime,
      picRawName: log.picRawName,
      isUserPic: log.isUserPic,
      picPersonnelId: log.picPersonnelId,
      picResolvedName: log.picResolvedName,
      isPilotFlying: log.isPilotFlying,
      suggestedDayTakeoffs: log.suggestedDayTakeoffs,
      suggestedNightTakeoffs: log.suggestedNightTakeoffs,
      suggestedDayLandings: log.suggestedDayLandings,
      suggestedNightLandings: log.suggestedNightLandings,
      toLdgContext: log.toLdgContext,
      remarks: log.remarks,
    } as ParsedSector & Record<string, unknown>);
  }

  // Pass through unmatched schedule sectors so the reconciler still creates
  // them (future flights without a corresponding logbook entry yet).
  const unmatchedSchedule: ParsedSector[] = [];
  schedule.operations.forEach((op, i) => {
    if (usedScheduleIndices.has(i)) return;
    const sector = sectorOf(op);
    if (sector) {
      unmatchedSchedule.push(sector);
      merged.push(sector);
    }
  });

  // Reference normalize() to keep the import live for future name-merging
  // logic; tree-shaking will drop it if unused.
  void normalize;

  return { sectors: merged, unmatchedLogbook, unmatchedSchedule };
}
