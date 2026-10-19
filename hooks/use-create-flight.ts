import { useCallback } from "react"
import { addFlight, isLiveFlight, userDb } from "@/lib/db"
import { createEmptyFlightLog } from "@/lib/utils/flight-calculations"
import { isSimulatorEntry } from "@/lib/utils/entry-type"

/**
 * The seat a new flight starts in: the one the pilot flew most recently.
 *
 * It used to be PIC for everyone. A first officer entering flights by hand then
 * had to change it on every entry, and forgetting is not cosmetic — the role
 * times are derived from `pilotRole`, so the block went into PIC hours. A seat
 * changes on upgrade, not from one flight to the next, so the last real flight
 * is the best guess there is. Simulators are skipped (a sim seat says nothing
 * about the line), and so is anything binned.
 */
async function lastPilotRole() {
  const latest = await userDb.flights
    .orderBy("date")
    .reverse()
    .filter((f) => isLiveFlight(f) && !isSimulatorEntry(f) && !!f.pilotRole)
    .first()
  return latest?.pilotRole
}

export function useCreateFlight() {
  return useCallback(async (date?: string) => {
    const emptyFlight = createEmptyFlightLog()
    const pilotRole = (await lastPilotRole().catch(() => undefined)) ?? emptyFlight.pilotRole
    return addFlight({
      ...emptyFlight,
      pilotRole,
      date: date || new Date().toISOString().split("T")[0],
    })
  }, [])
}
