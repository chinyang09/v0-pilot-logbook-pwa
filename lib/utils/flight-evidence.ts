/**
 * What a flight record's OWN figures say about who flew it, for the one case
 * where a record arrives without saying so outright: a stored or pushed flight
 * missing `pilotFlying` or `pilotRole` (an old build, a hand-written import).
 *
 * The schema's default for those fields used to be a constant — `pilotFlying:
 * true`, `pilotRole: "PIC"` — so a record that said nothing was silently filed
 * as flown, in command. Those are claims about the pilot, and a constant made
 * them for everybody. The record usually carries the answer: a takeoff or
 * landing logged, a role time, the seat the pilot sits in ("Self"). Only a
 * record with none of that falls through to the last resort, which is stated
 * once, here.
 *
 * A NEW flight is a different question — nothing has been recorded yet — and
 * its starting values come from the pilot's own settings (Settings › Logging),
 * never from this file.
 *
 * Pure and shared: the server's canonical shape (`lib/sync/schema.ts`) and the
 * client's normalizer both read it, so the two can never fill a gap differently.
 */

import type { PilotRole } from "@/types/entities/flight.types"
import { requiresTwoPilots } from "./crew-complement"

/**
 * The role of a flight nothing says anything about — no role time, not a
 * simulator, no "Self" seat, and no seat set in Settings › Logging. The one
 * place a role is assumed; setting "My seat" means it is never reached.
 */
export const UNSTATED_ROLE: PilotRole = "PIC"

/** Any flight-shaped value — a stored row, a pushed document, a form's state. */
type Record_ = object

function minutes(value: unknown): number {
  if (typeof value !== "string") return 0
  const m = /^(\d{1,4}):(\d{2})$/.exec(value.trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0
}

function count(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** A flight the pilot operated — not a simulator session, not a positioning sector. */
function isOperatedFlight(flight: Record<string, unknown>): boolean {
  if (flight.isSimulator === true) return false
  return flight.entryType !== "simulator" && flight.entryType !== "positioning"
}

const named = (v: unknown) => typeof v === "string" && v.trim() !== ""

/** A pilot on board beyond the two seats — an augmented crew's relief pilot. */
function hasReliefPilot(flight: Record<string, unknown>): boolean {
  const extra = flight.additionalCrew
  return Array.isArray(extra) && extra.some((c) => c && (c as { role?: unknown }).role === "Relief Pilot")
}

/**
 * Flown as one of a multi-pilot crew, on the record's own evidence, strongest
 * first: a type certificated for two pilots (`crew-complement.ts` — every
 * airline sector, whether or not its co-pilot was recorded), a co-pilot role
 * (a co-pilot exists only where more than one pilot is required), both pilot
 * seats filled, or a relief pilot aboard. Only an operated flight has any:
 * a simulator session and a positioning sector are not flight time.
 */
export function isMultiPilotFlight(record: Record_): boolean {
  const flight = record as Record<string, unknown>
  if (!isOperatedFlight(flight)) return false
  if (requiresTwoPilots(flight.aircraftType as string | undefined)) return true
  if (flight.pilotRole === "SIC" || flight.pilotRole === "PICUS") return true
  return (named(flight.picName) && named(flight.sicName)) || hasReliefPilot(flight)
}

/**
 * A flight auto-fill may call SOLO: operated, flown as PIC, on a type a single
 * pilot may fly, with nobody else in a seat or in the additional crew. That is
 * as far as a record can see — it does not know about passengers, which is why
 * the solo switch is off until a pilot turns it on.
 */
export function isSoloFlight(record: Record_): boolean {
  const flight = record as Record<string, unknown>
  if (!isOperatedFlight(flight) || flight.pilotRole !== "PIC") return false
  if (isMultiPilotFlight(record)) return false
  const others = [flight.picName, flight.sicName].filter((n) => named(n) && String(n).trim().toLowerCase() !== "self")
  const extra = Array.isArray(flight.additionalCrew) ? flight.additionalCrew.length : 0
  return others.length === 0 && extra === 0
}

/**
 * Why the solo time on a record cannot be right, or `null`. A flag, not a
 * correction: the figure is the pilot's, and the form says what is wrong with
 * it rather than quietly zeroing it.
 */
export function soloConflict(record: Record_): string | null {
  const flight = record as Record<string, unknown>
  if (minutes(flight.soloTime) === 0) return null
  const type = typeof flight.aircraftType === "string" ? flight.aircraftType.trim().toUpperCase() : ""
  if (requiresTwoPilots(type)) return `The ${type} is certified for two pilots — it cannot be flown solo`
  if (isMultiPilotFlight(record)) return "Another pilot is recorded on this flight"
  return null
}

/**
 * The multi-pilot time a record stored without one should carry: its block
 * time when the record shows a multi-pilot crew. The rule auto-fill applies
 * to a new flight, used here for one written before the field existed.
 */
export function inferMultiPilotTime(record: Record_): string {
  const block = (record as Record<string, unknown>).blockTime
  return isMultiPilotFlight(record) && typeof block === "string" && minutes(block) > 0 ? block : "00:00"
}

/** Flown by this pilot when it logs one of their takeoffs or landings. */
export function inferPilotFlying(record: Record_): boolean {
  const flight = record as Record<string, unknown>
  return count(flight.dayTakeoffs) + count(flight.nightTakeoffs) + count(flight.dayLandings) + count(flight.nightLandings) > 0
}

const ROLE_TIMES: [PilotRole, string][] = [
  ["PIC", "picTime"],
  ["SIC", "sicTime"],
  ["PICUS", "picusTime"],
  ["Dual", "dualTime"],
  ["Instructor", "instructorTime"],
]

/**
 * The role the record's own figures show, in order of how directly they say
 * it: the role time logged (the column a licence authority reads), then a
 * simulator (logged Dual — the session's instructor is in command), then the
 * seat the pilot is written into as "Self". The last resort, for a record that
 * says none of those, is `UNSTATED_ROLE`.
 */
export function inferPilotRole(record: Record_): PilotRole {
  const flight = record as Record<string, unknown>
  let best: PilotRole | null = null
  let most = 0
  for (const [role, key] of ROLE_TIMES) {
    const m = minutes(flight[key])
    if (m > most) [best, most] = [role, m]
  }
  if (best) return best
  if (flight.isSimulator === true || flight.entryType === "simulator") return "Dual"
  const isSelf = (name: unknown) => typeof name === "string" && name.trim().toLowerCase() === "self"
  if (isSelf(flight.sicName)) return "SIC"
  return UNSTATED_ROLE
}
