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
