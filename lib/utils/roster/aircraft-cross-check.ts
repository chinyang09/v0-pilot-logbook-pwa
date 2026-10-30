/**
 * After an import: a flight logged on a different aeroplane from the one
 * that day's published schedule assigned gets a NOTE in Discrepancies — never
 * a change. Either the report or the schedule has it wrong, and only the
 * pilot knows which; the licence record keeps what the report said until they
 * decide.
 *
 * Asked only where the schedule exists — a week back to a day ahead
 * (`flight/suggest`'s `scheduled` basis, with a registration) — so a month's
 * roster costs a handful of lookups, not one per sector. A note is raised
 * once per flight (`aircraft-check:<flight>`) and resolves itself once the
 * two agree.
 */

import type { FlightLog } from "@/types/entities/flight.types"
import type { FlightSuggestion } from "@/lib/lookup/flight-suggest"
import { normalizeRegistration } from "@/lib/utils/string"

const DAY_MS = 86_400_000
/** A flight number's list runs about a week back and a week ahead; the aeroplane is named from the day it flies. */
const WINDOW = { back: 7, ahead: 1 }
/** At most this many lookups for one import. */
export const CROSS_CHECK_LIMIT = 24

export const aircraftCheckNoteId = (flightId: string) => `aircraft-check:${flightId}`

/** Whether a flight's UTC date is one the published schedule still names an aeroplane for. */
export function withinScheduleWindow(date: string, nowMs: number): boolean {
  const at = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(at)) return false
  const today = Math.floor(nowMs / DAY_MS) * DAY_MS
  return at >= today - WINDOW.back * DAY_MS && at <= today + WINDOW.ahead * DAY_MS
}

/** The schedule's aeroplane, when that day's schedule names one and it is not the record's. */
export function scheduledAircraftDiffers(flight: Pick<FlightLog, "aircraftReg">, s: FlightSuggestion): string | null {
  if (s.basis !== "scheduled" || !s.registration || !flight.aircraftReg) return null
  return normalizeRegistration(s.registration) === normalizeRegistration(flight.aircraftReg) ? null : s.registration
}

/** The flights an import touched that the check can ask about, nearest today first. */
export function crossCheckCandidates(flights: FlightLog[], nowMs: number): FlightLog[] {
  return flights
    .filter((f) => !!f.flightNumber && !!f.aircraftReg && withinScheduleWindow(f.date, nowMs))
    .sort((a, b) => Math.abs(Date.parse(a.date) - nowMs) - Math.abs(Date.parse(b.date) - nowMs))
    .slice(0, CROSS_CHECK_LIMIT)
}

/** Runs the check over the flights an import touched. Answers how many notes it raised. */
export async function crossCheckImportedAircraft(flightIds: string[], nowMs = Date.now()): Promise<number> {
  if (flightIds.length === 0) return 0
  const [{ userDb }, { ensureDiscrepancy, resolveDiscrepancy }, { isLiveFlight }, { lookup }, { pooledForEach }] = await Promise.all([
    import("@/lib/db/user-db"),
    import("@/lib/db/stores/user/discrepancies.store"),
    import("@/lib/db"),
    import("@/lib/lookup/client"),
    import("@/lib/utils/parsers/shared/pooled-map"),
  ])
  const rows = (await userDb.flights.bulkGet(flightIds)).filter((f): f is FlightLog => !!f && isLiveFlight(f))
  let raised = 0
  await pooledForEach(crossCheckCandidates(rows, nowMs), async (flight) => {
    const answer = await lookup.flightSuggest(flight.flightNumber, flight.date, flight.scheduledOut || undefined)
    if (!answer.ok) return
    const scheduled = scheduledAircraftDiffers(flight, answer.data)
    const id = aircraftCheckNoteId(flight.id)
    if (!scheduled) {
      // Agreeing now: a note raised earlier closes itself.
      const note = await userDb.discrepancies.get(id)
      if (note && !note.resolved && answer.data.registration) {
        await resolveDiscrepancy(id, "keep_logbook", "The aircraft now matches the schedule.")
      }
      return
    }
    const added = await ensureDiscrepancy({
      id,
      type: "aircraft_mismatch",
      severity: "info",
      flightLogId: flight.id,
      field: "aircraftReg",
      logbookValue: flight.aircraftReg,
      scheduleValue: scheduled,
      message:
        `${flight.flightNumber} on ${flight.date} is logged on ${flight.aircraftReg}; that day's published ` +
        `schedule had ${scheduled}. Nothing was changed — check which is right.`,
      resolved: false,
    })
    if (added) raised++
  }, 3)
  return raised
}
