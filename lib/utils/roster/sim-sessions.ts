/**
 * Recognising a simulator session in the logbook, for import dedup.
 *
 * Separate from the executor so the matching rules can be tested without a
 * database: they are the whole reason a re-imported report stopped growing an
 * EBT row per upload.
 */

import { isSimulatorEntry } from "@/lib/utils/entry-type";
import type { FlightLog } from "@/types/entities/flight.types";

/**
 * A simulator session, identified by what it IS rather than by a field that
 * older rows may not carry.
 *
 * Every re-import was creating another EBT row. Matching on
 * `date|simSessionCode` only recognises sims written by a build that stored
 * both, so any sim logged by an earlier build (or by hand) was invisible to
 * the check and got duplicated on every upload. A sim is now recognised
 * structurally — no airports and no registration — and matched on its date
 * and window, which every version has always written.
 */
export function looksLikeSimulator(flight: FlightLog): boolean {
  if (isSimulatorEntry(flight)) return true;
  // Legacy rows: a logbook entry with no route and no aircraft is a sim.
  return (
    !flight.departureIata &&
    !flight.arrivalIata &&
    !flight.aircraftReg &&
    Boolean(flight.date)
  );
}

/** UTC date shifted by whole days, as YYYY-MM-DD. */
export function shiftIsoDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Is `existing` the same session as the incoming one?
 *
 * Date tolerance is ±1 day: the same EBT is logged 13 May in the UTC logbook
 * and scheduled 14 May in the Local Base schedule. Beyond the date, EITHER a
 * matching session code OR a matching start time is enough — a legacy row has
 * no code, and a hand-typed one may have no exact time.
 */
export function isSameSimSession(
  existing: FlightLog,
  incoming: { date: string; code: string; outUtc?: string }
): boolean {
  const dateMatches =
    existing.date === incoming.date ||
    existing.date === shiftIsoDate(incoming.date, -1) ||
    existing.date === shiftIsoDate(incoming.date, 1);
  if (!dateMatches) return false;

  const existingCode = (existing.simSessionCode || "").toUpperCase();
  if (existingCode && incoming.code && existingCode === incoming.code) {
    return true;
  }
  if (incoming.outUtc && existing.outTime && existing.outTime === incoming.outUtc) {
    return true;
  }
  // Same day, one of the two carries no identifying detail at all — treat a
  // lone sim on that date as the same session rather than adding another.
  return !existingCode && !existing.outTime;
}
