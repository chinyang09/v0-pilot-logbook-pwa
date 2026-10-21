import { useCallback } from "react"
import {
  addFlight,
  getCurrentUserPersonnel,
  getLoggingProfile,
  getUserPreferences,
  isLiveFlight,
  userDb,
} from "@/lib/db"
import { createEmptyFlightLog } from "@/lib/utils/flight-calculations"
import { isSimulatorEntry } from "@/lib/utils/entry-type"
import { nonPicPfRoleOf, roleForSeat, seatOf } from "@/lib/utils/roster/pilot-role"

/**
 * The seat a new flight starts in comes from the pilot's "This is me" crew
 * card: a captain is PIC, a first officer is SIC — or, flying, whatever their
 * card says they log a flown leg as (PICUS). They are also put in that seat as
 * "Self", the way every import writes them.
 *
 * It used to be PIC for everyone, so a first officer entering flights by hand
 * corrected it on every entry — and a missed correction is not cosmetic: the
 * role times derive from `pilotRole`, so the block went into PIC hours.
 *
 * With no seat on the card, the most recent real flight's role is the best
 * guess left (a seat changes on upgrade, not between flights).
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
    const prefs = await getUserPreferences().catch(() => null)
    // PF or PM is the pilot's own setting (Settings › Logging).
    const emptyFlight = createEmptyFlightLog({ pilotFlying: prefs?.logging?.newFlightPilotFlying })
    const flightDate = date || new Date().toISOString().split("T")[0]
    const self = await getLoggingProfile().catch(() => null)
    const seat = seatOf(self)
    let seating: Partial<typeof emptyFlight> = {}
    if (self && seat) {
      const pilotRole = roleForSeat(
        seat,
        emptyFlight.pilotFlying,
        nonPicPfRoleOf(self, prefs?.importDefaults?.nonPicPfRole, flightDate)
      )
      seating =
        seat === "captain"
          ? { pilotRole, picId: self.id, picName: "Self" }
          : { pilotRole, sicId: self.id, sicName: "Self" }
    } else {
      const pilotRole = await lastPilotRole().catch(() => undefined)
      if (pilotRole) seating = { pilotRole }
    }
    return addFlight({
      ...emptyFlight,
      ...seating,
      date: flightDate,
    })
  }, [])
}
