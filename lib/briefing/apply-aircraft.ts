/**
 * The OFP's aeroplane written onto the logbook (`briefingAircraftPatch`): at
 * a briefing's import, and once per launch for the briefings around today.
 * Apart from `import.ts` so the launch pass does not pull in the PDF reader.
 */

import { briefingAircraftPatch } from "./aircraft"
import { flightBriefingId } from "./ids"
import { getAllFlights, updateFlight } from "@/lib/db/stores/user/flights.store"
import { batchGetAircraftByRegistrations } from "@/lib/db/stores/reference/aircraft.store"
import { getEntryType } from "@/lib/utils/entry-type"
import { userDb } from "@/lib/db/user-db"
import type { BriefingRecord } from "@/types/entities/briefing.types"
import type { FlightLog } from "@/types/entities/flight.types"

/**
 * The OFP's aeroplane onto its logbook flight (`briefingAircraftPatch`) —
 * the flight whose briefing id this is (`flightBriefingId`), through
 * `updateFlight` so it syncs as a field patch. Answers how many flights moved.
 */
export async function applyBriefingAircraft(
  record: Pick<BriefingRecord, "id" | "registration" | "aircraftType">,
  all?: readonly FlightLog[],
): Promise<number> {
  if (!record.registration?.trim()) return 0
  const flights = (all ?? (await getAllFlights())).filter(
    (f) => !!f.flightNumber && !!f.departureIcao && getEntryType(f) === "flight" && flightBriefingId(f) === record.id,
  )
  if (flights.length === 0) return 0
  const known = [...(await batchGetAircraftByRegistrations([record.registration]).catch(() => new Map())).values()][0]
  let moved = 0
  for (const f of flights) {
    const patch = briefingAircraftPatch(f, record, known ?? null)
    if (patch && (await updateFlight(f.id, patch))) moved++
  }
  return moved
}

/**
 * The same for every briefing of the last few days and the days ahead, once
 * per launch: a briefing imported before its flight was (a roster import
 * after the PDF), or pulled from another device, reaches the flight too.
 * Read by the `date` index — a briefing is ~65KB, never the whole table.
 */
export async function applyRecentBriefingAircraft(now = Date.now()): Promise<number> {
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  const recent = (await userDb.briefings.where("date").between(day(now - 3 * 86_400_000), day(now + 3 * 86_400_000), true, true).toArray()).filter(
    (r) => !r.deletedAt && !!r.registration,
  )
  if (recent.length === 0) return 0
  const flights = await getAllFlights()
  let moved = 0
  for (const r of recent) moved += await applyBriefingAircraft(r, flights)
  return moved
}
