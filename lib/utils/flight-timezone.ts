/**
 * The UTC offsets a flight STORES for its two airports, set against what the
 * airports' zones say they were at the time. Pure: the offset lookup is passed
 * in, so the rule is tested without IndexedDB or a real zone database.
 *
 * Two ways the stored figure went wrong in production:
 * - every Indian airport was stored as UTC+5, because the offset was parsed
 *   off "GMT+05:30" as an integer;
 * - three flights carried 0 at Manila, Davao and Jakarta, because their
 *   airport had not resolved when they were written.
 *
 * Both feed the FDP calculator's local report time and anything else that
 * reads a flight in local time, so a stale offset is a wrong answer there.
 */
import type { FlightLog } from "@/types/entities/flight.types"

/** Hours east of UTC for an IANA zone at an instant, or null when unknown. */
export type OffsetAt = (tz: string, at: Date) => number | null

function instant(date: string, time: string | undefined): Date {
  const hhmm = time && /^\d{1,2}:\d{2}$/.test(time) ? time.padStart(5, "0") : "12:00"
  return new Date(`${date}T${hhmm}:00Z`)
}

export function timezoneRepairPatch(
  flight: Pick<FlightLog, "date" | "outTime" | "inTime" | "departureTimezone" | "arrivalTimezone">,
  depTz: string | null | undefined,
  arrTz: string | null | undefined,
  offsetAt: OffsetAt
): Partial<Pick<FlightLog, "departureTimezone" | "arrivalTimezone">> {
  const patch: Partial<Pick<FlightLog, "departureTimezone" | "arrivalTimezone">> = {}
  if (!flight.date) return patch
  const dep = depTz ? offsetAt(depTz, instant(flight.date, flight.outTime)) : null
  const arr = arrTz ? offsetAt(arrTz, instant(flight.date, flight.inTime || flight.outTime)) : null
  if (dep != null && Math.abs((flight.departureTimezone ?? NaN) - dep) > 1e-6) patch.departureTimezone = dep
  if (arr != null && Math.abs((flight.arrivalTimezone ?? NaN) - arr) > 1e-6) patch.arrivalTimezone = arr
  return patch
}
