import type { FlightLog } from "@/lib/db"
import { createEmptyFlightLog } from "@/lib/utils/flight-calculations"

export type DeriveKind = "next-leg" | "return-trip" | "duplicate"

/**
 * Build a NEW flight from an existing one.
 *
 * What every kind carries over is the stuff that does not change between two
 * legs flown back to back — the aircraft, the crew, the pilot's own role — and
 * what none of them carry is anything that is a record of a specific flight
 * having happened: the OOOI times, the report time, the takeoffs and landings,
 * the signature, the lock, and every import/sync stamp. Copying those forward
 * would fabricate a logbook entry, which is the one thing a logbook must never
 * do. (This is an allowlist rather than an omission list, so a new field is
 * left behind by default — keep it that way.)
 *
 * - **next-leg** continues the trip: yesterday's arrival is today's departure,
 *   so the route is chained (arrival → new departure) and the far end is left
 *   blank for the pilot to fill in.
 * - **return-trip** flies it back: the route is reversed.
 * - **duplicate** is the same sector again — same route, blank times.
 */
export function deriveFlight(
  source: FlightLog,
  kind: DeriveKind
): Omit<FlightLog, "id" | "createdAt" | "updatedAt" | "syncStatus"> {
  const empty = createEmptyFlightLog()

  const route =
    kind === "return-trip"
      ? {
          departureIcao: source.arrivalIcao,
          departureIata: source.arrivalIata,
          departureTimezone: source.arrivalTimezone,
          arrivalIcao: source.departureIcao,
          arrivalIata: source.departureIata,
          arrivalTimezone: source.departureTimezone,
        }
      : kind === "next-leg"
        ? {
            departureIcao: source.arrivalIcao,
            departureIata: source.arrivalIata,
            departureTimezone: source.arrivalTimezone,
            // Deliberately blank — the whole point of a next leg is that where
            // it goes is not known from the flight it follows.
            arrivalIcao: "",
            arrivalIata: "",
            arrivalTimezone: 0,
          }
        : {
            departureIcao: source.departureIcao,
            departureIata: source.departureIata,
            departureTimezone: source.departureTimezone,
            arrivalIcao: source.arrivalIcao,
            arrivalIata: source.arrivalIata,
            arrivalTimezone: source.arrivalTimezone,
          }

  return {
    ...empty,
    ...route,
    date: source.date,
    aircraftReg: source.aircraftReg,
    aircraftType: source.aircraftType,
    picId: source.picId,
    picName: source.picName,
    sicId: source.sicId,
    sicName: source.sicName,
    additionalCrew: source.additionalCrew ? [...source.additionalCrew] : [],
    pilotRole: source.pilotRole,
    // A duplicate repeats the sector as flown, so it keeps who was flying;
    // a next leg or a return normally swaps, and guessing wrong writes a
    // claim about the pilot's own record. Left at the form's default there.
    pilotFlying: kind === "duplicate" ? source.pilotFlying : empty.pilotFlying,
    entryType: source.entryType,
    isSimulator: source.isSimulator,
  }
}
