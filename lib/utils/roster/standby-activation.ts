/**
 * Was this standby called out, and when?
 *
 * FIFTH SCHEDULE para 6(6): "the standby duty ceases from the moment the crew
 * member is activated for duty; and the duty period commences from the moment
 * that crew member reports for duty at the designated reporting point."
 *
 * The FDP pipeline answers this in `truncateActivatedStandby`, working in duty
 * periods. The ROSTER page needs the same answer from what it has — schedule
 * entries and flights — because it reads `scheduleEntries` directly and never
 * sees a duty period. Both go through `findActivationMinute`, so there is one
 * rule rather than two that drift.
 */

import type { FlightLog } from "@/types/entities/flight.types"
import type { ScheduleEntry } from "@/types/entities/roster.types"
import { hhmmToMinutes, minutesToHHMM } from "@/lib/utils/time"
import { findActivationMinute } from "@/lib/utils/roster/fdp-calculator"
import { PRE_FLIGHT_CHECK_MIN } from "@/lib/utils/roster/regulation-definitions"

const DAY_MINUTES = 1440

function dayNumber(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000)
}

/**
 * When a flight's duty period reported, in absolute minutes.
 *
 * Same precedence the duty-period producer uses: a stated report wins, then
 * the ROSTERED one (scheduled gate-out less the pre-flight hour), then the
 * actual gate-out. Deriving it from the actual gate-out alone would move the
 * activation with a pushback delay.
 */
function reportMinuteOf(flight: FlightLog): number | null {
  const basis =
    flight.reportTime ||
    (flight.scheduledOut
      ? minutesToHHMM(
          (hhmmToMinutes(flight.scheduledOut) - PRE_FLIGHT_CHECK_MIN + DAY_MINUTES) %
            DAY_MINUTES
        )
      : flight.outTime
        ? minutesToHHMM(
            (hhmmToMinutes(flight.outTime) - PRE_FLIGHT_CHECK_MIN + DAY_MINUTES) %
              DAY_MINUTES
          )
        : "")
  if (!basis || !flight.date) return null
  return dayNumber(flight.date) * DAY_MINUTES + hhmmToMinutes(basis)
}

export interface StandbyActivation {
  /** UTC HH:MM the standby ceased. */
  at: string
  /** The flight whose duty period began it. */
  flightId: string
  /** How long the standby actually ran, in minutes. */
  standbyMinutes: number
}

/**
 * The activation of one standby entry, from the flights on hand.
 *
 * Returns null for a standby that was never called out — which is most of
 * them, and which the app treats as rest.
 */
export function standbyActivation(
  entry: ScheduleEntry,
  flights: FlightLog[]
): StandbyActivation | null {
  if (entry.dutyType !== "standby" || !entry.reportTime || !entry.debriefTime) {
    return null
  }

  const startAbs = dayNumber(entry.date) * DAY_MINUTES + hhmmToMinutes(entry.reportTime)
  let endMin = hhmmToMinutes(entry.debriefTime)
  if (endMin <= hhmmToMinutes(entry.reportTime)) endMin += DAY_MINUTES
  const endAbs = dayNumber(entry.date) * DAY_MINUTES + endMin

  const reports = new Map<number, string>()
  for (const flight of flights) {
    const at = reportMinuteOf(flight)
    // First flight to claim a minute wins; a duty's later sectors report at
    // the same instant and only the first is the activation.
    if (at !== null && !reports.has(at)) reports.set(at, flight.id)
  }

  const activationAbs = findActivationMinute(startAbs, endAbs, [...reports.keys()])
  if (activationAbs === null) return null

  return {
    at: minutesToHHMM(((activationAbs % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES),
    flightId: reports.get(activationAbs)!,
    standbyMinutes: activationAbs - startAbs,
  }
}
