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
 * Apply long sector adjustment for large aeroplanes.
 * A single long sector counts as multiple sectors for table lookup.
 *
 * Table A: >7h≤9h → 2, >9h≤11h → 3, >11h → 4
 * Table B: >7h≤9h → 3, >9h≤11h → 4, >11h → 5
 *
 * @param sectors - Actual number of sectors
 * @param longestSectorMinutes - Block time of the longest sector in minutes
 * @param table - Which table is being used ("A" or "B")
 * @returns Effective sector count (never less than actual sectors)
 */
export function applyLongSectorAdjustment(
  sectors: number,
  longestSectorMinutes: number,
  table: "A" | "B"
): number {
  if (longestSectorMinutes <= 420) return sectors // ≤ 7h, no adjustment

  let longSectorEquivalent: number
  if (table === "A") {
    if (longestSectorMinutes <= 540) longSectorEquivalent = 2       // >7h ≤9h
    else if (longestSectorMinutes <= 660) longSectorEquivalent = 3  // >9h ≤11h
    else longSectorEquivalent = 4                                    // >11h
  } else {
    if (longestSectorMinutes <= 540) longSectorEquivalent = 3       // >7h ≤9h
    else if (longestSectorMinutes <= 660) longSectorEquivalent = 4  // >9h ≤11h
    else longSectorEquivalent = 5                                    // >11h
  }

  // Replace 1 actual sector with its equivalent, add remaining sectors
  const effectiveSectors = longSectorEquivalent + (sectors - 1)
  return Math.max(effectiveSectors, sectors)
}

// ============================================
// Augmented Crew Extension (Reg 15)
// ============================================

/**
 * Apply augmented crew FDP extension cap.
 * +1 crew member + rest facilities → max 15h (900 min)
 * +2 crew members + rest facilities → max 18h (1080 min)
 *
 * The augmented max is a cap — it allows up to 15h/18h but does not
 * reduce below the base table FDP value.
 *
 * @param baseFdpMinutes - FDP from table lookup
 * @param level - Augmented crew level
 * @returns Adjusted max FDP in minutes
 */
export function applyAugmentedCrewExtension(
  baseFdpMinutes: number,
  level: AugmentedCrewLevel
): number {
  switch (level) {
    case "plus-one":
      return Math.max(baseFdpMinutes, Math.min(900, 900))   // cap at 15h
    case "plus-two":
      return Math.max(baseFdpMinutes, Math.min(1080, 1080)) // cap at 18h
    default:
      return baseFdpMinutes
  }
}

// ============================================
// Acclimation Check
// ============================================

/**
 * Determine if crew is acclimated based on departure timezone offset.
 * Acclimated = time difference from SGT (UTC+8) is ≤ 2 hours.
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
