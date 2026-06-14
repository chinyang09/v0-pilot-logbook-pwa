/**
 * Time Reference Normalizer
 *
 * Converts schedule CSV times (UTC, Local Base, or Local Station) into canonical
 * UTC date + HH:MM pairs.
 *
 * The three formats differ only in WHICH timezone the raw time is expressed in:
 *   - UTC:            raw time is already UTC (offset 0 for all roles).
 *   - LOCAL_BASE:     raw time is in the pilot's base airport TZ for all roles.
 *   - LOCAL_STATION:  raw time uses the DEPARTURE airport TZ for OUT/OFF and the
 *                     ARRIVAL airport TZ for ON/IN — so a single leg can
 *                     straddle two offsets.
 *
 * DST handling: offsets are resolved for the row date via Intl.DateTimeFormat
 * with the IANA tz, so historical DST transitions are respected.
 */

// ============================================================
// Types
// ============================================================

export type TimeReference = "UTC" | "LOCAL_BASE" | "LOCAL_STATION";

/**
 * Which OOOI role this time represents.
 * OUT/OFF use the departure airport's TZ under LOCAL_STATION;
 * ON/IN use the arrival airport's TZ.
 */
export type TimeRole = "out" | "off" | "on" | "in";

export interface ParsedTimeToken {
  /** Canonical "HH:MM" with A and ⁺¹/⁻¹ stripped */
  time: string;
  /** True if the raw token was prefixed with 'A' (actual time) */
  isActual: boolean;
  /**
   * Integer day delta from the row date.
   *   ⁺¹ → +1 (next day, e.g. midnight rollover after a late departure)
   *   ⁻¹ → -1 (previous day, when the report displays an early-morning
   *           sector under the next calendar day's row)
   *    none → 0
   */
  dayDelta: number;
  /**
   * Convenience alias for `dayDelta > 0`. Kept for backwards compatibility
   * with callers that only handle the +1 case.
   * @deprecated read `dayDelta` instead — it carries both +1 and -1.
   */
  nextDay: boolean;
}

export interface NormalizeInput {
  /** Raw CSV time token — may include 'A' prefix and/or '⁺¹' suffix. */
  rawTime: string;
  /** The row's base date in YYYY-MM-DD (the date that heads the CSV row). */
  rowDate: string;
  /** Which CSV time-reference frame this value is in. */
  timeReference: TimeReference;
  /** Which OOOI role this time plays. */
  role: TimeRole;
  /** Departure airport IANA timezone (used for LOCAL_STATION OUT/OFF). */
  depTz: string;
  /** Arrival airport IANA timezone (used for LOCAL_STATION ON/IN). */
  arrTz: string;
  /**
   * Pilot's base airport IANA timezone. Required for LOCAL_BASE; ignored for
   * UTC. Optional for LOCAL_STATION (unused, but accepted for API symmetry).
   */
  baseTz?: string;
}

export interface NormalizedTime {
  /** UTC time in "HH:MM". */
  utcTime: string;
  /** UTC calendar date in "YYYY-MM-DD" after applying any day rollover. */
  utcDate: string;
}

// ============================================================
// Token parsing
// ============================================================

// Accepts a trailing day-shift marker:
//   ⁺¹  = next day (most common — late-night departure rolls over)
//   ⁻¹  = previous day (early-morning sector shown under the next day's row)
//   "+1" / "-1" ASCII fallbacks for CSV exports that strip the superscripts.
const TIME_TOKEN_RE = /^A?(\d{1,2}):(\d{2})(⁺¹|⁻¹|\+1|-1)?$/;

/**
 * Parse a raw CSV time token into its components.
 * Returns null for malformed or out-of-range tokens.
 */
export function parseTimeToken(raw: string): ParsedTimeToken | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const match = trimmed.match(TIME_TOKEN_RE);
  if (!match) return null;

  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours > 23 ||
    minutes > 59
  ) {
    return null;
  }

  const marker = match[3];
  const dayDelta =
    marker === "⁺¹" || marker === "+1"
      ? 1
      : marker === "⁻¹" || marker === "-1"
        ? -1
        : 0;

  return {
    time: `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}`,
    isActual: trimmed.startsWith("A"),
    dayDelta,
    nextDay: dayDelta > 0,
  };
}

// ============================================================
// DST-aware offset lookup
// ============================================================

/**
 * Get the UTC offset (in hours) for an IANA timezone at a specific date.
 *
 * Uses Intl.DateTimeFormat with longOffset to resolve offsets accurately for
 * the given date, so DST transitions are handled correctly.
 *
 * Limitation: offsets that are not whole-hour (e.g., IST UTC+5:30) are
 * truncated to whole hours. For the Scoot route network this is acceptable,
 * but it means times in IST-based stations carry 30 minutes of systematic
 * error. If/when half-hour TZs become relevant, switch the return type to
 * minutes and propagate through the downstream math.
 */
export function getOffsetForDate(tz: string, isoDate: string): number {
  if (!tz || !isoDate) return 0;
  try {
    // Anchor on midday UTC to avoid landing exactly on a DST transition instant
    const anchor = new Date(`${isoDate}T12:00:00Z`);
    if (Number.isNaN(anchor.getTime())) return 0;

    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "longOffset",
    }).formatToParts(anchor);

    const offsetPart = parts.find((p) => p.type === "timeZoneName")?.value;
    if (!offsetPart) return 0;

    // longOffset yields strings like "GMT+08:00", "GMT-05:00", or just "GMT"
    if (offsetPart === "GMT") return 0;
    const match = offsetPart.match(/([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!match) return 0;

    const sign = match[1] === "-" ? -1 : 1;
    const hours = Number.parseInt(match[2], 10);
    // Minutes are currently truncated — see doc comment.
    return sign * hours;
  } catch {
    return 0;
  }
}

// ============================================================
// Core normalization
// ============================================================

const MINUTES_PER_DAY = 24 * 60;

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function minutesToHHMM(totalMinutes: number): string {
  const total = Math.round(totalMinutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

function shiftDate(isoDate: string, dayDelta: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dayDelta);
  return d.toISOString().slice(0, 10);
}

function isValidIsoDate(isoDate: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return false;
  const d = new Date(`${isoDate}T00:00:00Z`);
  return !Number.isNaN(d.getTime());
}

/**
 * Convert a raw CSV time token to canonical UTC date + HH:MM.
 *
 * Returns null when the token or row date is malformed, so callers can
 * surface a parse error without crashing the whole import.
 */
export function normalizeTimeToUTC(
  input: NormalizeInput
): NormalizedTime | null {
  const parsed = parseTimeToken(input.rawTime);
  if (!parsed) return null;
  if (!isValidIsoDate(input.rowDate)) return null;

  // 1. Build local calendar position (in the appropriate source TZ).
  //    Apply the ⁺¹ / ⁻¹ day marker BEFORE TZ subtraction — the marker is
  //    relative to the row date in the source frame.
  let localDayDelta = parsed.dayDelta;
  const localMinutes = hhmmToMinutes(parsed.time);

  // 2. Determine offset (hours) to subtract to reach UTC, based on reference.
  let offsetHours: number;
  switch (input.timeReference) {
    case "UTC":
      offsetHours = 0;
      break;
    case "LOCAL_BASE":
      if (!input.baseTz) return null;
      offsetHours = getOffsetForDate(input.baseTz, input.rowDate);
      break;
    case "LOCAL_STATION": {
      const tz =
        input.role === "out" || input.role === "off"
          ? input.depTz
          : input.arrTz;
      offsetHours = getOffsetForDate(tz, input.rowDate);
      break;
    }
    default:
      return null;
  }

  // 3. Subtract offset — local time becomes UTC. Normalize into [0, 1440).
  let utcTotalMinutes = localMinutes - offsetHours * 60;

  while (utcTotalMinutes < 0) {
    utcTotalMinutes += MINUTES_PER_DAY;
    localDayDelta -= 1;
  }
  while (utcTotalMinutes >= MINUTES_PER_DAY) {
    utcTotalMinutes -= MINUTES_PER_DAY;
    localDayDelta += 1;
  }

  return {
    utcTime: minutesToHHMM(utcTotalMinutes),
    utcDate: shiftDate(input.rowDate, localDayDelta),
  };
}
