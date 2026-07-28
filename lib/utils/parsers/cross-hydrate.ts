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
 * Within a key, pairs are chosen by departure-time agreement, decided across
 * the whole import at once (see `assignSchedule`).
 */

import {
  assignByCost,
  endpointDelta,
  type ScoredPair,
} from "@/lib/utils/roster/match-assign";
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

// Cost charged when neither side offers a comparable departure time, so a
// timeless pair ranks below every pair whose times actually agree but still
// beats no pair at all — leaving both sides unmatched would make the
// reconciler create TWO flights for one leg (the duplicate-flight bug).
const NO_TIME_COST = 90;

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

/**
 * Pair logbook rows with schedule sectors globally rather than row by row.
 *
 * Same reasoning as the reconciler's own matcher: on a day that repeats a
 * route, walking the logbook in order and taking the closest remaining
 * schedule sector can strand the true pair — the first row claims a sector the
 * second row needed. Scoring every candidate pair and claiming cheapest-first
 * is order-independent and lands the exact-time pairs first.
 *
 * Returns logbook index → schedule entry.
 */
function assignSchedule(
  logbookSectors: ParsedLogbookSector[],
  scheduleIndex: Map<string, ScheduleSectorWithIndex[]>
): Map<number, ScheduleSectorWithIndex> {
  // Schedule entries are addressed by their position in a flat list so the
  // shared assigner can claim each at most once.
  const entries: ScheduleSectorWithIndex[] = [];
  const entryPosition = new Map<number, number>();
  for (const list of scheduleIndex.values()) {
    for (const entry of list) {
      entryPosition.set(entry.index, entries.length);
      entries.push(entry);
    }
  }

  const pairs: ScoredPair[] = [];
  logbookSectors.forEach((log, left) => {
    const key = keyFor(
      log.date,
      log.departureIata,
      log.arrivalIata,
      log.aircraftType
    );
    for (const entry of scheduleIndex.get(key) ?? []) {
      const right = entryPosition.get(entry.index);
      if (right === undefined) continue;
      const delta =
        endpointDelta(
          log.outTime,
          undefined,
          entry.sector.actualOut,
          entry.sector.scheduledOut
        ) ?? NO_TIME_COST;
      pairs.push({ left, right, cost: delta });
    }
  });

  const assignment = assignByCost(pairs);
  const matches = new Map<number, ScheduleSectorWithIndex>();
  for (const [left, right] of assignment) matches.set(left, entries[right]);
  return matches;
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

/**
 * Promote a parsed logbook sector to the reconciler's `ParsedSector` shape.
 *
 * This is the SINGLE mapper shared by the logbook-only import path and both
 * cross-hydrate branches. It also encodes the flown-vs-planned decision:
 * a PLANNED sector (dated after the report's generation) carries scheduled
 * times only — no actual out/in, no block, no pilot-flying — so a future
 * roster leg is stored as a scheduled placeholder instead of being hydrated
 * as if it had already been flown.
 */
export function logbookSectorToParsedSector(
  s: ParsedLogbookSector
): ParsedSector {
  const planned = s.planned === true;
  return {
    date: s.date,
    flightNumber: s.flightNumber ?? "",
    aircraftType: s.aircraftType,
    departureIata: s.departureIata,
    arrivalIata: s.arrivalIata,
    departureIcao: s.departureIcao,
    arrivalIcao: s.arrivalIcao,
    scheduledOut: planned ? s.outTime || undefined : undefined,
    scheduledIn: planned ? s.inTime || undefined : undefined,
    actualOut: planned ? undefined : s.outTime || undefined,
    actualIn: planned ? undefined : s.inTime || undefined,
    sourceLine: s.sourceLine,
    crew: undefined,
    aircraftReg: s.aircraftReg,
    dayTakeoffs: s.dayTakeoffs,
    nightTakeoffs: s.nightTakeoffs,
    dayLandings: s.dayLandings,
    nightLandings: s.nightLandings,
    blockTime: planned ? "00:00" : s.blockTime,
    picRawName: s.picRawName,
    isUserPic: s.isUserPic,
    picPersonnelId: s.picPersonnelId,
    picResolvedName: s.picResolvedName,
    isPilotFlying: planned ? undefined : s.isPilotFlying,
    suggestedDayTakeoffs: s.suggestedDayTakeoffs,
    suggestedNightTakeoffs: s.suggestedNightTakeoffs,
    suggestedDayLandings: s.suggestedDayLandings,
    suggestedNightLandings: s.suggestedNightLandings,
    toLdgContext: s.toLdgContext,
    remarks: s.remarks,
  };
}

/** The ParsedSector carried by a schedule op, if any (delete/skip_non_airline carry none). */
function sectorOf(
  op: PlannedImport["operations"][number]
): ParsedSector | undefined {
  switch (op.kind) {
    case "create":
    case "skip_identical":
    case "skip_decided":
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

  const scheduleMatches = assignSchedule(logbook.sectors, scheduleIndex);

  logbook.sectors.forEach((log, logIndex) => {
    const match = scheduleMatches.get(logIndex);

    if (!match) {
      unmatchedLogbook.push(log);
      // Promote the logbook sector (no schedule info; flightNumber/crew empty).
      merged.push(logbookSectorToParsedSector(log));
      return;
    }

    usedScheduleIndices.add(match.index);
    const sched = match.sector;

    // Start from the logbook mapping (which already applies flown-vs-planned),
    // then overlay the schedule's authoritative fields: flight number, full
    // crew, scheduled times, and the specific aircraft subtype ("32N" vs the
    // logbook family "320"). Actual times stay whatever the logbook side
    // resolved (a flown leg keeps its actuals; a planned leg has none).
    const base = logbookSectorToParsedSector(log);
    merged.push({
      ...base,
      flightNumber: sched.flightNumber || base.flightNumber,
      aircraftType:
        sched.aircraftType && sched.aircraftType.length === 3
          ? sched.aircraftType
          : base.aircraftType,
      scheduledOut: sched.scheduledOut ?? base.scheduledOut,
      scheduledIn: sched.scheduledIn ?? base.scheduledIn,
      actualOut: base.actualOut ?? sched.actualOut,
      actualIn: base.actualIn ?? sched.actualIn,
      crew: mergeCrew(log, sched.crew ?? []),
    });
  });

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
