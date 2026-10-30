/**
 * A next leg or a return, filled from what its aeroplane flies NEXT — the
 * missing sector on a day no roster has been imported for. Asked once, right
 * after the leg is created from the flight before it: where does that
 * aeroplane go after landing from it? (`aircraft/whereabouts` asked at that
 * flight's arrival.) `seedFromNextFlight` decides what may be written, and the
 * write is an ordinary `updateFlight`, so it syncs like any edit and the open
 * form follows the row.
 *
 * Fire-and-forget: offline, unknown or ambiguous, the leg simply stays as the
 * pilot made it.
 */

import type { FlightLog } from "@/lib/db"
import { flightInstantMs } from "@/lib/airports/code-changes"
import { lookup } from "@/lib/lookup/client"
import { seedFromNextFlight } from "@/lib/utils/flight-seed"

export async function seedDerivedLeg(created: FlightLog, source: FlightLog): Promise<boolean> {
  const arrivalTime = source.inTime || source.scheduledIn
  if (!created.aircraftReg || !arrivalTime || !source.date) return false
  const arrivedMs = flightInstantMs(source.date, arrivalTime, source.outTime || source.scheduledOut)
  if (arrivedMs === null) return false

  // A minute after it landed: the flight it landed from is the inbound, and
  // `next` is what the aeroplane does after it.
  const answer = await lookup.aircraftWhereabouts(created.aircraftReg, new Date(arrivedMs + 60_000).toISOString())
  if (!answer.ok || !answer.data.next) return false

  const { getFlightById, updateFlight } = await import("@/lib/db")
  const current = await getFlightById(created.id)
  if (!current) return false
  const patch = seedFromNextFlight(current, answer.data.next, { allowDate: true })
  if (Object.keys(patch).length === 0) return false
  await updateFlight(created.id, patch)
  return true
}
