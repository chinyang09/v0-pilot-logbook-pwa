/**
 * CAAS Regulation 14 Fifth Schedule — FDP Lookup Tables
 *
 * Table A: 2-pilot, acclimated (time diff ≤ 2h from SGT)
 * Table B: 2-pilot, non-acclimated (time diff > 2h from SGT)
 * Table C: Single pilot
 *
 * Long sector adjustment: Reg 14(2) — large aeroplanes
 * Augmented crew extension: Reg 15 — +1 crew (15h) / +2 crew (18h)
 */

import type { AugmentedCrewLevel } from "@/types/entities/roster.types"

// ============================================
// Table A: 2-pilot, acclimated (Reg 14(1)(a))
// ============================================
// Rows: [startHour, endHour, [1-sector, 2-sector, ..., 8+-sector]]
// All values in minutes
const TABLE_A: Array<[number, number, number[]]> = [
  [6, 8,   [780, 735, 690, 645, 600, 555, 540, 540]],  // 0600-0759
  [8, 15,  [840, 795, 750, 705, 660, 615, 570, 540]],  // 0800-1459
  [15, 22, [780, 735, 690, 645, 600, 555, 540, 540]],  // 1500-2159
  [22, 6,  [660, 615, 570, 540, 540, 540, 540, 540]],  // 2200-0559
]

// ============================================
// Table B: 2-pilot, non-acclimated (Reg 14(1)(b))
// ============================================
// No time-of-start variation — sector count only
// [1-sector, 2-sector, 3-sector, 4-sector, 5-sector, 6+-sector]
// All values in minutes
const TABLE_B: number[] = [750, 720, 660, 630, 600, 540]

// ============================================
// Table C: Single pilot (Reg 14(1A))
// ============================================
// Rows: [startHour, endHour, [≤4-sector, 5-sector, 6-sector, 7-sector, 8+-sector]]
// All values in minutes
const TABLE_C: Array<[number, number, number[]]> = [
  [6, 8,   [600, 555, 510, 480, 480]],  // 0600-0759
  [8, 15,  [660, 615, 570, 525, 480]],  // 0800-1459
  [15, 22, [600, 555, 510, 480, 480]],  // 1500-2159
  [22, 6,  [540, 495, 480, 480, 480]],  // 2200-0559
]

// ============================================
// Helpers
// ============================================

/** Base timezone offset for acclimation check (SGT = UTC+8) */
const BASE_TZ_OFFSET = 8

/** Max acclimation difference in hours */
const MAX_ACCLIMATION_DIFF = 2

/**
 * Get the row values for a time-of-start hour from a time-banded table.
 * Handles midnight-wrapping bands (e.g. 2200-0559).
 */
function getTimeRow(
  table: Array<[number, number, number[]]>,
  hour: number
): number[] {
  for (const [start, end, values] of table) {
    if (start < end) {
      // Normal range (e.g. 0600-0759 → 6 <= h < 8)
      if (hour >= start && hour < end) return values
    } else {
      // Wraps midnight (e.g. 2200-0559 → h >= 22 || h < 6)
      if (hour >= start || hour < end) return values
    }
  }
  // Fallback (should not happen with complete tables)
  return table[0][2]
}

// ============================================
// Lookup Functions
// ============================================

/**
 * Look up max FDP from Table A (2-pilot, acclimated).
 * @param localHour - Hour (0-23) of local start time at departure
 * @param effectiveSectors - Sector count after long sector adjustment
 * @returns Max FDP in minutes
 */
export function lookupTableA(localHour: number, effectiveSectors: number): number {
  const row = getTimeRow(TABLE_A, localHour)
  const idx = Math.min(Math.max(effectiveSectors, 1), 8) - 1
  return row[idx]
}

/**
 * Look up max FDP from Table B (2-pilot, non-acclimated).
 * No time-of-start variation.
 * @param effectiveSectors - Sector count after long sector adjustment
 * @returns Max FDP in minutes
 */
export function lookupTableB(effectiveSectors: number): number {
  const idx = Math.min(Math.max(effectiveSectors, 1), 6) - 1
  return TABLE_B[idx]
}

/**
 * Look up max FDP from Table C (single pilot).
 * @param localHour - Hour (0-23) of local start time at departure
 * @param sectors - Total sectors to be flown
 * @returns Max FDP in minutes
 */
export function lookupTableC(localHour: number, sectors: number): number {
  const row = getTimeRow(TABLE_C, localHour)
  // Table C columns: ≤4, 5, 6, 7, 8+
  if (sectors <= 4) return row[0]
  const idx = Math.min(sectors - 4, 4) // 5→1, 6→2, 7→3, 8+→4
  return row[idx]
}

// ============================================
// Long Sector Adjustment (Reg 14(2))
// ============================================

/**
 * What ONE sector of a given block time counts as, per para 14(2).
 *
 * | Single sector length (block time) | Table A | Table B |
 * |---|---|---|
 * | Over 7 but not over 9 hours | 2 | 3 |
 * | Over 9 but not over 11 hours | 3 | 4 |
 * | Over 11 hours | 4 | 5 |
 *
 * The boundaries are "over X but not over Y", so exactly 7:00 is not over 7
 * and exactly 9:00 is not over 9.
 */
function sectorCountsAs(blockMinutes: number, table: "A" | "B"): number {
  if (blockMinutes <= 7 * 60) return 1
  if (blockMinutes <= 9 * 60) return table === "A" ? 2 : 3
  if (blockMinutes <= 11 * 60) return table === "A" ? 3 : 4
  return table === "A" ? 4 : 5
}

/**
 * Apply the long sector adjustment of para 14(2).
 *
 * **EVERY long sector counts up, not just the longest.** The schedule says
 * "counting long sectorS as more than one sector", and a duty of two 8-hour
 * sectors is four effective sectors under Table A rather than three. Counting
 * only the longest under-states the sector count, which RAISES the FDP maximum
 * — the dangerous direction to be wrong in.
 *
 * The caller may pass either every sector's block time (preferred) or a single
 * figure for the longest one, which is all the older callers had.
 *
 * Note this adjustment applies only where the assigned flight crew "only
 * consists of 2 pilots" — `calculateMaxFDP` is what enforces that.
 *
 * @param sectors - Actual number of sectors flown
 * @param sectorMinutes - Every sector's block time, or just the longest
 * @param table - Which table is being used ("A" or "B")
 * @returns Effective sector count (never less than the actual count)
 */
export function applyLongSectorAdjustment(
  sectors: number,
  sectorMinutes: number | number[],
  table: "A" | "B"
): number {
  const lengths = Array.isArray(sectorMinutes) ? sectorMinutes : [sectorMinutes]

  // Each supplied length contributes what it counts as; any sector we have no
  // length for counts as itself.
  const counted = lengths
    .slice(0, sectors)
    .reduce((total, minutes) => total + sectorCountsAs(minutes, table), 0)
  const unmeasured = Math.max(0, sectors - Math.min(lengths.length, sectors))

  return Math.max(counted + unmeasured, sectors)
}

// ============================================
// Augmented Crew Extension (Reg 15)
// ============================================

/**
 * Apply the augmented flight crew extension of para 15.
 *
 * - augmented with ONE extra flight crew member and a rest facility for one
 *   pilot → up to a maximum FDP of **15 hours**;
 * - augmented with TWO and rest facilities for two pilots → **18 hours**.
 *
 * **Rest facilities are a CONDITION, not a detail.** Para 15(1)(b) requires
 * "appropriate in-flight rest facilities", and 15(3)(b) states outright that
 * "no extension of flight duty period is permitted even with augmented flight
 * crew if no rest facilities are available". So the extension is withheld when
 * facilities are absent — and also when they are simply UNKNOWN, because
 * guessing in favour of a longer duty is the wrong way to be wrong.
 *
 * The extension is a ceiling, never a reduction: a base maximum already above
 * it stands.
 *
 * @param baseFdpMinutes - FDP from the table lookup
 * @param level - Augmented crew level
 * @param inFlightRestFacilities - Whether suitable facilities are confirmed
 */
export function applyAugmentedCrewExtension(
  baseFdpMinutes: number,
  level: AugmentedCrewLevel,
  inFlightRestFacilities?: boolean
): number {
  if (level === "none") return baseFdpMinutes
  if (inFlightRestFacilities !== true) return baseFdpMinutes

  switch (level) {
    case "plus-one":
      return Math.max(baseFdpMinutes, 15 * 60)
    case "plus-two":
      return Math.max(baseFdpMinutes, 18 * 60)
    default:
      return baseFdpMinutes
  }
}

// ============================================
// Acclimation Check
// ============================================

/**
 * Whether Table A applies, per para 14(1)(a): the time difference between the
 * person's ACCLIMATED time and the local time where the FDP commences "does
 * not exceed 2 hours".
 *
 * The acclimated time is approximated by home base (SGT). That is exact for a
 * pilot who has been operating from base, and it is what the schedule's own
 * para 5(5) implies is restored by 82 hours at base after a long trip away; it
 * is an approximation for a pilot part-way through a multi-day pattern in
 * another zone, where the acclimated time has drifted. Erring toward Table A
 * would raise the maximum, so any doubt should move a duty to Table B.
 *
 * Examples:
 *   SIN (UTC+8) → true (diff = 0)
 *   BKK (UTC+7) → true (diff = 1)
 *   NRT (UTC+9) → true (diff = 1)
 *   LHR (UTC+0) → false (diff = 8)
 *   JFK (UTC-5) → false (diff = 13)
 */
export function isAcclimated(departureTimezoneOffset: number): boolean {
  return Math.abs(departureTimezoneOffset - BASE_TZ_OFFSET) <= MAX_ACCLIMATION_DIFF
}
