import { describe, expect, it } from "vitest"

import {
  lookupTableA,
  lookupTableB,
  lookupTableC,
  applyLongSectorAdjustment,
  applyAugmentedCrewExtension,
  isAcclimated,
} from "../fdp-tables"
import { calculateMaxFDP, mergeAdjacentDutyPeriods } from "../fdp-calculator"

/**
 * Air Navigation (121 — Commercial Air Transport by Large Aeroplanes)
 * Regulations, FIFTH SCHEDULE (Regulation 178), paragraphs 14 and 15.
 *
 * Every figure below is transcribed from the schedule itself, not from the
 * implementation, so this file is the check ON the tables rather than a copy of
 * them. A wrong cell here is a pilot flying to the wrong limit, which is the
 * one failure mode on this screen that matters.
 *
 * Quarter-hours in the schedule are written as fractions (12 ¼); minutes here.
 */

const H = (h: number, quarters = 0) => h * 60 + quarters * 15

/* ── Table A — para 14(1)(a): 2 pilots, acclimated ─────────────────────────
 *
 *   Total sectors to be flown
 *   Local time of start  1      2      3      4     5   6     7     8+
 *   0600 – 0759          13     12¼    11½    10¾   10  9¼    9     9
 *   0800 – 1459          14     13¼    12½    11¾   11  10¼   9½    9
 *   1500 – 2159          13     12¼    11½    10¾   10  9¼    9     9
 *   2200 – 0559          11     10¼    9½     9     9   9     9     9
 */
const TABLE_A_ROWS: Array<{ band: string; hours: number[]; sampleHours: number[] }> = [
  {
    band: "0600 – 0759",
    hours: [H(13), H(12, 1), H(11, 2), H(10, 3), H(10), H(9, 1), H(9), H(9)],
    sampleHours: [6, 7],
  },
  {
    band: "0800 – 1459",
    hours: [H(14), H(13, 1), H(12, 2), H(11, 3), H(11), H(10, 1), H(9, 2), H(9)],
    sampleHours: [8, 11, 14],
  },
  {
    band: "1500 – 2159",
    hours: [H(13), H(12, 1), H(11, 2), H(10, 3), H(10), H(9, 1), H(9), H(9)],
    sampleHours: [15, 18, 21],
  },
  {
    band: "2200 – 0559",
    hours: [H(11), H(10, 1), H(9, 2), H(9), H(9), H(9), H(9), H(9)],
    sampleHours: [22, 23, 0, 3, 5],
  },
]

describe("Table A — para 14(1)(a), 2 pilots, acclimated", () => {
  for (const row of TABLE_A_ROWS) {
    it(`matches the schedule for ${row.band}`, () => {
      for (const hour of row.sampleHours) {
        for (let sectors = 1; sectors <= 8; sectors++) {
          expect(lookupTableA(hour, sectors), `${row.band} h${hour} ${sectors} sectors`).toBe(
            row.hours[sectors - 1],
          )
        }
      }
    })
  }

  it("holds the 8+ column for any larger sector count", () => {
    expect(lookupTableA(9, 12)).toBe(H(9))
  })

  it("puts each band boundary on the right side", () => {
    // The bands are inclusive of their stated start and run to one minute
    // before the next: 0759 is still the early band, 0800 is the long one.
    expect(lookupTableA(7, 1)).toBe(H(13))
    expect(lookupTableA(8, 1)).toBe(H(14))
    expect(lookupTableA(14, 1)).toBe(H(14))
    expect(lookupTableA(15, 1)).toBe(H(13))
    expect(lookupTableA(21, 1)).toBe(H(13))
    expect(lookupTableA(22, 1)).toBe(H(11))
    expect(lookupTableA(5, 1)).toBe(H(11))
    expect(lookupTableA(6, 1)).toBe(H(13))
  })
})

/* ── Table B — para 14(1)(b): 2 pilots, any other case ─────────────────────
 *   Total sectors   1      2    3    4      5    6+
 *   Maximum FDP     12½    12   11   10½    10   9
 */
describe("Table B — para 14(1)(b), 2 pilots, not acclimated", () => {
  it("matches the schedule", () => {
    const expected = [H(12, 2), H(12), H(11), H(10, 2), H(10), H(9)]
    for (let sectors = 1; sectors <= 6; sectors++) {
      expect(lookupTableB(sectors), `${sectors} sectors`).toBe(expected[sectors - 1])
    }
  })

  it("has no time-of-start variation, unlike Table A", () => {
    expect(lookupTableB(2)).toBe(H(12))
  })

  it("holds the 6+ column for any larger sector count", () => {
    expect(lookupTableB(9)).toBe(H(9))
  })
})

/* ── Table C — para 14(1A): single pilot aeroplane ─────────────────────────
 *   Local time of start  Up to 4   5     6     7     8+
 *   0600 – 0759          10        9¼    8½    8     8
 *   0800 – 1459          11        10¼   9½    8¾    8
 *   1500 – 2159          10        9¼    8½    8     8
 *   2200 – 0559          9         8¼    8     8     8
 */
const TABLE_C_ROWS: Array<{ band: string; hours: number[]; sampleHours: number[] }> = [
  { band: "0600 – 0759", hours: [H(10), H(9, 1), H(8, 2), H(8), H(8)], sampleHours: [6, 7] },
  { band: "0800 – 1459", hours: [H(11), H(10, 1), H(9, 2), H(8, 3), H(8)], sampleHours: [8, 14] },
  { band: "1500 – 2159", hours: [H(10), H(9, 1), H(8, 2), H(8), H(8)], sampleHours: [15, 21] },
  { band: "2200 – 0559", hours: [H(9), H(8, 1), H(8), H(8), H(8)], sampleHours: [22, 2, 5] },
]

describe("Table C — para 14(1A), single pilot", () => {
  for (const row of TABLE_C_ROWS) {
    it(`matches the schedule for ${row.band}`, () => {
      for (const hour of row.sampleHours) {
        // The first column is "Up to 4" — one, two, three and four sectors all
        // share it.
        for (const sectors of [1, 2, 3, 4]) {
          expect(lookupTableC(hour, sectors), `${row.band} h${hour} ${sectors}`).toBe(row.hours[0])
        }
        for (const sectors of [5, 6, 7, 8]) {
          expect(lookupTableC(hour, sectors), `${row.band} h${hour} ${sectors}`).toBe(
            row.hours[sectors - 4],
          )
        }
      }
    })
  }
})

/* ── Long sector adjustment — para 14(2) ───────────────────────────────────
 *                                        Count as (sectors)
 *   Single sector length (block time)    Table A   Table B
 *   Over 7 but not over 9 hours          2         3
 *   Over 9 but not over 11 hours         3         4
 *   Over 11 hours                        4         5
 */
describe("Long sector adjustment — para 14(2)", () => {
  it("matches the schedule's count-as values", () => {
    // One sector, of each length band, counts as the stated number.
    expect(applyLongSectorAdjustment(1, H(8), "A")).toBe(2)
    expect(applyLongSectorAdjustment(1, H(10), "A")).toBe(3)
    expect(applyLongSectorAdjustment(1, H(12), "A")).toBe(4)

    expect(applyLongSectorAdjustment(1, H(8), "B")).toBe(3)
    expect(applyLongSectorAdjustment(1, H(10), "B")).toBe(4)
    expect(applyLongSectorAdjustment(1, H(12), "B")).toBe(5)
  })

  it("puts each length boundary on the right side", () => {
    // "Over 7 but not over 9": exactly 7h is not over 7, exactly 9h is not over 9.
    expect(applyLongSectorAdjustment(1, H(7), "A")).toBe(1)
    expect(applyLongSectorAdjustment(1, H(7) + 1, "A")).toBe(2)
    expect(applyLongSectorAdjustment(1, H(9), "A")).toBe(2)
    expect(applyLongSectorAdjustment(1, H(9) + 1, "A")).toBe(3)
    expect(applyLongSectorAdjustment(1, H(11), "A")).toBe(3)
    expect(applyLongSectorAdjustment(1, H(11) + 1, "A")).toBe(4)
  })

  it("leaves short sectors alone", () => {
    expect(applyLongSectorAdjustment(4, H(3), "A")).toBe(4)
    expect(applyLongSectorAdjustment(4, 0, "B")).toBe(4)
  })

  it("counts the other sectors alongside the long one", () => {
    // A 3-sector duty whose longest is 8h: that sector counts as 2, the other
    // two count as themselves.
    expect(applyLongSectorAdjustment(3, H(8), "A")).toBe(4)
  })

  it("counts EVERY long sector, not only the longest", () => {
    // The schedule says long sectorS, plural. A duty with two sectors of 8h
    // each is 2 + 2 = 4 effective sectors under Table A, not 2 + 1 = 3.
    // Under-counting here raises the FDP maximum, which is the dangerous
    // direction to be wrong in.
    expect(applyLongSectorAdjustment(2, [H(8), H(8)], "A")).toBe(4)
    expect(applyLongSectorAdjustment(2, [H(8), H(8)], "B")).toBe(6)
    // A long one and a short one: 2 + 1.
    expect(applyLongSectorAdjustment(2, [H(8), H(2)], "A")).toBe(3)
    // Three sectors, one over 11h and one over 9h: 4 + 3 + 1.
    expect(applyLongSectorAdjustment(3, [H(12), H(10), H(1)], "A")).toBe(8)
  })
})

/* ── Augmented crew — para 15 ──────────────────────────────────────────── */
describe("Augmented flight crew — para 15", () => {
  it("extends to 15 hours with one extra crew member and a rest facility", () => {
    expect(applyAugmentedCrewExtension(H(11), "plus-one", true)).toBe(H(15))
  })

  it("extends to 18 hours with two extra crew members and rest facilities", () => {
    expect(applyAugmentedCrewExtension(H(11), "plus-two", true)).toBe(H(18))
  })

  it("permits NO extension without rest facilities — para 15(3)(b)", () => {
    // "no extension of flight duty period is permitted even with augmented
    // flight crew if no rest facilities are available".
    expect(applyAugmentedCrewExtension(H(11), "plus-one", false)).toBe(H(11))
    expect(applyAugmentedCrewExtension(H(11), "plus-two", false)).toBe(H(11))
  })

  it("withholds the extension when the facilities are unknown", () => {
    // Para 15(1) makes appropriate rest facilities a CONDITION of the
    // extension. Unknown is not satisfied, and guessing in favour of a longer
    // duty is the wrong way to be wrong.
    expect(applyAugmentedCrewExtension(H(11), "plus-one")).toBe(H(11))
  })

  it("never reduces the base maximum", () => {
    expect(applyAugmentedCrewExtension(H(18, 2), "plus-one", true)).toBe(H(18, 2))
  })
})

/* ── Acclimatisation — para 14(1)(a) ───────────────────────────────────── */
describe("Acclimatisation — para 14(1)(a)", () => {
  it("uses Table A within 2 hours of the acclimated time", () => {
    expect(isAcclimated(8)).toBe(true) // SIN
    expect(isAcclimated(7)).toBe(true) // BKK
    expect(isAcclimated(9)).toBe(true) // NRT-ish
    expect(isAcclimated(6)).toBe(true) // exactly 2h — "does not exceed 2 hours"
    expect(isAcclimated(10)).toBe(true)
  })

  it("uses Table B beyond that", () => {
    expect(isAcclimated(5)).toBe(false)
    expect(isAcclimated(11)).toBe(false)
    expect(isAcclimated(0)).toBe(false) // LHR
    expect(isAcclimated(-5)).toBe(false) // JFK
  })
})

/* ── End to end, through calculateMaxFDP ──────────────────────────────── */
describe("calculateMaxFDP — the schedule applied", () => {
  it("gives different limits for different sector counts at the same report time", () => {
    const at = (sectors: number) =>
      calculateMaxFDP({ reportTimeLocal: "09:00", sectors }).maxFdpMinutes

    expect(at(1)).toBe(H(14))
    expect(at(2)).toBe(H(13, 1))
    expect(at(4)).toBe(H(11, 3))
    expect(at(6)).toBe(H(10, 1))
  })

  it("gives different limits for the same sectors at different report times", () => {
    const at = (reportTimeLocal: string) =>
      calculateMaxFDP({ reportTimeLocal, sectors: 2 }).maxFdpMinutes

    expect(at("06:30")).toBe(H(12, 1)) // early
    expect(at("09:00")).toBe(H(13, 1)) // the long band
    expect(at("16:00")).toBe(H(12, 1)) // afternoon
    expect(at("23:30")).toBe(H(10, 1)) // through the night
    expect(at("02:00")).toBe(H(10, 1)) // still the night band
  })

  it("drops to Table B away from the acclimated time", () => {
    const home = calculateMaxFDP({
      reportTimeLocal: "09:00",
      sectors: 2,
      departureTimezoneOffset: 8,
    })
    const away = calculateMaxFDP({
      reportTimeLocal: "09:00",
      sectors: 2,
      departureTimezoneOffset: 0,
    })

    expect(home.tableUsed).toBe("A")
    expect(home.maxFdpMinutes).toBe(H(13, 1))
    expect(away.tableUsed).toBe("B")
    expect(away.maxFdpMinutes).toBe(H(12))
  })

  it("uses Table C for a single-pilot aeroplane", () => {
    const r = calculateMaxFDP({
      reportTimeLocal: "09:00",
      sectors: 2,
      crewConfig: "single-pilot",
    })
    expect(r.tableUsed).toBe("C")
    expect(r.maxFdpMinutes).toBe(H(11))
  })

  it("applies the long-sector adjustment through the sector count", () => {
    // One 8-hour sector at 09:00 counts as two, so the 2-sector column applies.
    const r = calculateMaxFDP({
      reportTimeLocal: "09:00",
      sectors: 1,
      longestSectorMinutes: H(8),
    })
    expect(r.effectiveSectors).toBe(2)
    expect(r.maxFdpMinutes).toBe(H(13, 1))
  })

  it("does NOT apply the long-sector adjustment to an augmented crew", () => {
    // Para 14(2) applies "when the assigned flight crew ... only consists of
    // 2 pilots". An augmented crew is not that crew.
    const r = calculateMaxFDP({
      reportTimeLocal: "09:00",
      sectors: 1,
      longestSectorMinutes: H(12),
      augmentedCrew: "plus-one",
      inFlightRestFacilities: true,
    })
    expect(r.effectiveSectors).toBe(1)
    expect(r.maxFdpMinutes).toBe(H(15))
  })

  it("does not apply the long-sector adjustment to a single pilot either", () => {
    // Para 14(2) names Table A and Table B; Table C is not in it.
    const r = calculateMaxFDP({
      reportTimeLocal: "09:00",
      sectors: 2,
      crewConfig: "single-pilot",
      longestSectorMinutes: H(12),
    })
    expect(r.effectiveSectors).toBe(2)
    expect(r.maxFdpMinutes).toBe(H(11))
  })

  it("accepts every sector's length and counts each long one", () => {
    // Two 8-hour sectors at 09:00 → 4 effective sectors → 11¾ hours.
    const r = calculateMaxFDP({
      reportTimeLocal: "09:00",
      sectors: 2,
      sectorMinutes: [H(8), H(8)],
    })
    expect(r.effectiveSectors).toBe(4)
    expect(r.maxFdpMinutes).toBe(H(11, 3))
  })
})

/* ── Merged duties — para 14(2) must survive the merge ────────────────── */
describe("mergeAdjacentDutyPeriods keeps the long sector adjustment", () => {
  const base = {
    flightMinutes: 0,
    fdpExtensionUsed: false,
    source: "logbook" as const,
    isFuture: false,
    scheduleEntryIds: [] as string[],
    flightIds: [] as string[],
    departureTimezoneOffset: 8,
  }

  it("re-applies it from the merged sectors' block times", () => {
    // Two duties, each one 8-hour sector, separated by less than minimum rest —
    // so they merge into one overnight duty of two long sectors. Under para
    // 14(2) each 8-hour sector counts as 2, giving 4 effective sectors and an
    // 11¾-hour maximum at an 09:00 report.
    //
    // Recomputing from the sector COUNT alone gave 2 sectors and 13¼ hours: an
    // hour and a half of FDP the schedule does not allow.
    const merged = mergeAdjacentDutyPeriods([
      {
        ...base,
        id: "a",
        date: "2026-08-14",
        reportTime: "01:00",
        debriefTime: "10:00",
        dutyMinutes: 9 * 60,
        sectorCount: 1,
        maxFdpMinutes: 0,
        sectorMinutes: [H(8)],
      },
      {
        ...base,
        id: "b",
        date: "2026-08-14",
        reportTime: "14:00",
        debriefTime: "23:00",
        dutyMinutes: 9 * 60,
        sectorCount: 1,
        maxFdpMinutes: 0,
        sectorMinutes: [H(8)],
      },
    ])

    expect(merged).toHaveLength(1)
    expect(merged[0].sectorCount).toBe(2)
    expect(merged[0].sectorMinutes).toEqual([H(8), H(8)])
    expect(merged[0].effectiveSectors).toBe(4)
    expect(merged[0].maxFdpMinutes).toBe(H(11, 3))
  })
})
