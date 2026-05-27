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

  const logOut = hhmmToMinutes(log.outTime || "00:00");
  let best: ScheduleSectorWithIndex | null = null;
  let bestDelta = Infinity;

  for (const entry of pool) {
    const sched = entry.sector;
    const cmpRaw = sched.actualOut || sched.scheduledOut || "00:00";
    const cmp = hhmmToMinutes(cmpRaw);
    const delta = Math.abs(cmp - logOut);
    if (delta < bestDelta && delta <= MATCH_WINDOW_MIN) {
      bestDelta = delta;
      best = entry;
    }
  }
  return best;
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

export function crossHydrate(
  logbook: PlannedLogbookImport,
  schedule: PlannedImport
): CrossHydrateResult {
  // Build an index of schedule sectors by match key (collisions kept as a list
  // so we can disambiguate by time).
  const scheduleIndex = new Map<string, ScheduleSectorWithIndex[]>();
  schedule.operations.forEach((op, i) => {
    if (op.kind !== "create" && op.kind !== "skip_identical") {
      // Only sectors backed by ParsedSector data have what we need.
      // For update_conflict / edited_conflict / update_consult / update_safe,
      // op.sector is also a ParsedSector — include those too.
      if (
        op.kind !== "update_conflict" &&
        op.kind !== "edited_conflict" &&
        op.kind !== "skip_non_airline" &&
        op.kind !== "delete_missing"
      ) {
        // unknown — skip
      }
    }
    // Extract sector when present.
    let sector: ParsedSector | undefined;
    switch (op.kind) {
      case "create":
      case "skip_identical":
      case "update_conflict":
      case "edited_conflict":
        sector = op.sector;
        break;
      default:
        return;
    }
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
    if (op.kind === "create" || op.kind === "skip_identical") {
      unmatchedSchedule.push(op.sector);
      merged.push(op.sector);
    }
  });

  // Reference normalize() to keep the import live for future name-merging
  // logic; tree-shaking will drop it if unused.
  void normalize;

  return { sectors: merged, unmatchedLogbook, unmatchedSchedule };
}
