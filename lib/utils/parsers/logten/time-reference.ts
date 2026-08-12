/**
 * Which zone a LogTen export's clock times are in, and the conversion to UTC.
 *
 * The app stores every clock time as UTC, and LogTen's export states no zone
 * at all — it writes whatever the app was configured to display, which for one
 * pilot is Zulu and for the next is local station time. Getting this wrong
 * shifts an entire logbook by hours, so it is DETECTED rather than assumed.
 *
 * The detection uses a fact already in the file: LogTen records both the
 * out/in clock times AND the block time (`flight_totalTime`) it computed from
 * them. On a sector between two DIFFERENT timezones the two readings disagree
 * by exactly the offset difference, so only one of them reproduces the block
 * time the file states:
 *
 *   UTC:   block = in − out
 *   local: block = (in − out) − (arrOffset − depOffset)
 *
 * A same-timezone sector satisfies both and is no evidence either way — which
 * is why the whole file votes rather than the first row, and why a purely
 * domestic operation ends up "assumed" and needs the caller's override.
 */

import type { LogtenTimeReference } from "./types";

/** Minutes between two clock times, wrapping over midnight. */
export function wrappedSpan(fromHHMM: string, toHHMM: string): number {
  const from = clockMinutes(fromHHMM);
  const to = clockMinutes(toHHMM);
  if (from < 0 || to < 0) return -1;
  let span = to - from;
  if (span < 0) span += 24 * 60;
  return span;
}

function clockMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(hhmm || "");
  if (!m) return -1;
  return +m[1] * 60 + +m[2];
}

export interface TimeReferenceSample {
  outTime: string;
  inTime: string;
  blockTime: string;
  depOffsetHours: number;
  arrOffsetHours: number;
}

export interface TimeReferenceVerdict {
  reference: LogtenTimeReference;
  confidence: "detected" | "assumed" | "forced";
  evidence: string;
}

/** How far a computed span may sit from the stated block time and still count. */
const TOLERANCE_MINUTES = 2;

export function detectTimeReference(
  samples: TimeReferenceSample[],
  forced?: LogtenTimeReference
): TimeReferenceVerdict {
  if (forced) {
    return {
      reference: forced,
      confidence: "forced",
      evidence: `Time reference set to ${forced.toUpperCase()} by you.`,
    };
  }

  let utcVotes = 0;
  let localVotes = 0;
  let usable = 0;

  for (const sample of samples) {
    const offsetDelta = sample.arrOffsetHours - sample.depOffsetHours;
    // Same offset either side: both readings give the same answer, so the row
    // cannot distinguish them. Skip rather than counting it for both.
    if (offsetDelta === 0) continue;

    const stated = clockMinutes(sample.blockTime);
    if (stated <= 0) continue;

    const naive = wrappedSpan(sample.outTime, sample.inTime);
    if (naive < 0) continue;

    usable++;
    const asUtc = naive;
    const asLocal = naive - offsetDelta * 60;

    const utcFits = Math.abs(asUtc - stated) <= TOLERANCE_MINUTES;
    const localFits = Math.abs(asLocal - stated) <= TOLERANCE_MINUTES;
    if (utcFits && !localFits) utcVotes++;
    else if (localFits && !utcFits) localVotes++;
  }

  if (utcVotes === 0 && localVotes === 0) {
    return {
      reference: "utc",
      confidence: "assumed",
      evidence:
        usable === 0
          ? "No cross-timezone sector with both times and a block time — assumed UTC."
          : `${usable} cross-timezone sector(s) matched neither reading — assumed UTC.`,
    };
  }

  const reference: LogtenTimeReference = localVotes > utcVotes ? "local" : "utc";
  const winner = Math.max(utcVotes, localVotes);
  const loser = Math.min(utcVotes, localVotes);
  return {
    reference,
    confidence: "detected",
    evidence: `${winner} of ${winner + loser} cross-timezone sector(s) reproduce the recorded block time as ${reference === "utc" ? "UTC" : "local station time"}.`,
  };
}

/**
 * A local clock time plus its date, expressed in UTC.
 *
 * The DATE comes back too because it can move: 03:40 local at UTC+8 is 19:40
 * the previous day in UTC, and the app keys a flight on the UTC date of its
 * OUT time. Dropping the date shift is how a whole night's flying ends up
 * filed a day late.
 */
export function localToUtc(
  isoDate: string,
  hhmm: string,
  offsetHours: number
): { date: string; time: string } {
  const minutes = clockMinutes(hhmm);
  if (minutes < 0 || !isoDate) return { date: isoDate, time: hhmm };

  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return { date: isoDate, time: hhmm };

  // Offsets can be fractional (UTC+5:30, +5:45) — go via minutes throughout.
  const utcMs =
    Date.UTC(y, m - 1, d, 0, 0) + (minutes - Math.round(offsetHours * 60)) * 60_000;
  const at = new Date(utcMs);

  return {
    date: `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}-${String(at.getUTCDate()).padStart(2, "0")}`,
    time: `${String(at.getUTCHours()).padStart(2, "0")}:${String(at.getUTCMinutes()).padStart(2, "0")}`,
  };
}
