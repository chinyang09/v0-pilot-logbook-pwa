/**
 * Puts right every flight that points at a crew card or a fleet record that
 * does not exist (`lib/utils/record-references.ts` decides what is broken).
 *
 * Runs once per sign-in or launch, after the initial sync, and only once this
 * device has completed a pull (`knownSeq`): before that, a card the server
 * holds but this device has not received yet would look missing, and creating
 * it again would overwrite the real one. Every write goes through the
 * sync-aware stores, so the repair is an ordinary edit every device pulls.
 * Idempotent: a whole logbook writes nothing.
 */

import { getCurrentUserPersonnel, updateFlight, userDb } from "@/lib/db"
import { putManyWithSync } from "@/lib/db/stores/user/crud-helpers"
import { getRoundTripSyncState } from "@/lib/db/stores/user/sync-queue.store"
import { crewReferenceRepairs, missingFleetRegistrations } from "@/lib/utils/record-references"
import { ensureAircraftForFlights } from "@/lib/utils/roster/executor"

export interface ReferenceRepairResult {
  cardsCreated: number
  flightsRepointed: number
  aircraftCreated: number
}

export async function repairRecordReferences(): Promise<ReferenceRepairResult> {
  const result: ReferenceRepairResult = { cardsCreated: 0, flightsRepointed: 0, aircraftCreated: 0 }
  if ((await getRoundTripSyncState()).knownSeq === 0) return result

  const [flights, cards, fleet, self] = await Promise.all([
    userDb.flights.toArray(),
    userDb.personnel.toArray(),
    userDb.aircraft.toArray(),
    getCurrentUserPersonnel(),
  ])

  const crew = crewReferenceRepairs(flights, cards, self?.id ?? null)
  // Cards first, so no flight is ever repointed at a card that is not there.
  result.cardsCreated = (await putManyWithSync(userDb.personnel, "personnel", crew.cardsToCreate, "create")).length
  for (const [id, patch] of crew.flightPatches) {
    if (await updateFlight(id, patch)) result.flightsRepointed++
  }

  const missing = missingFleetRegistrations(flights, fleet)
  if (missing.length > 0) {
    const fleetResult = { aircraftCreated: 0, aircraftUpdated: 0, errors: [] as { operation: string; message: string }[] }
    await ensureAircraftForFlights(missing, fleetResult)
    result.aircraftCreated = fleetResult.aircraftCreated
    for (const error of fleetResult.errors) console.error(`[Sync] ${error.operation}: ${error.message}`)
  }
  return result
}
