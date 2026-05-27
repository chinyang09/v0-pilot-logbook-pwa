/**
 * Concise day/night reclassification remark.
 *
 * Crew logbook reports carry a hand-entered day/night takeoff/landing split,
 * which is the most common manual-entry mistake we see in eCrew exports. The
 * flight form derives the split from sun position (recalculateFlightFields),
 * so the import trusts that calculation rather than prompting the user. The
 * TOTAL takeoffs/landings are always preserved — only the day↔night bucket
 * changes.
 *
 * When the sun-derived split differs from what the report logged, the executor
 * appends a short marker to the flight remarks so the reclassification is
 * visible to the user and detectable by future imports (so it isn't re-applied
 * or re-flagged).
 */

/** Detectable prefix written into remarks, e.g. "[d/n] LDG night→day". */
export const DAY_NIGHT_MARKER = "[d/n]";

/** Legacy marker written by older imports; still treated as "decided". */
const LEGACY_TOLDG_MARKER = "[TO/LDG decision recorded]";

export interface ToLdgSplit {
  dayTakeoffs?: number;
  nightTakeoffs?: number;
  dayLandings?: number;
  nightLandings?: number;
  /** Sun-derived split; only set by the parser when it differs from logged. */
  suggestedDayTakeoffs?: number;
  suggestedNightTakeoffs?: number;
  suggestedDayLandings?: number;
  suggestedNightLandings?: number;
}

/**
 * Build a concise remark line describing how the sun-derived split differs
 * from the logged split, or null when they agree (or no suggestion exists).
 * e.g. "[d/n] LDG night→day" or "[d/n] T/O day→night, LDG night→day".
 */
export function buildDayNightRemark(sector: ToLdgSplit): string | null {
  const parts: string[] = [];

  if (
    sector.suggestedDayTakeoffs !== undefined ||
    sector.suggestedNightTakeoffs !== undefined
  ) {
    const wasNight = (sector.nightTakeoffs ?? 0) > 0;
    const nowNight = (sector.suggestedNightTakeoffs ?? 0) > 0;
    if (wasNight !== nowNight) {
      parts.push(`T/O ${wasNight ? "night" : "day"}→${nowNight ? "night" : "day"}`);
    }
  }

  if (
    sector.suggestedDayLandings !== undefined ||
    sector.suggestedNightLandings !== undefined
  ) {
    const wasNight = (sector.nightLandings ?? 0) > 0;
    const nowNight = (sector.suggestedNightLandings ?? 0) > 0;
    if (wasNight !== nowNight) {
      parts.push(`LDG ${wasNight ? "night" : "day"}→${nowNight ? "night" : "day"}`);
    }
  }

  if (parts.length === 0) return null;
  return `${DAY_NIGHT_MARKER} ${parts.join(", ")}`;
}

/** True when remarks already record a day/night decision (new or legacy). */
export function hasDayNightRemark(remarks: string | undefined | null): boolean {
  const r = remarks || "";
  return r.includes(DAY_NIGHT_MARKER) || r.includes(LEGACY_TOLDG_MARKER);
}

/**
 * Append the day/night remark to existing remarks unless one is already
 * present. Returns the (possibly unchanged) remarks string.
 */
export function appendDayNightRemark(
  remarks: string | undefined,
  line: string | null
): string {
  const base = remarks ?? "";
  if (!line) return base;
  if (hasDayNightRemark(base)) return base;
  return base ? `${base}\n${line}` : line;
}
