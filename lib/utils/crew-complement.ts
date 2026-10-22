/**
 * How many pilots an aircraft type is certificated to be flown by, read off its
 * ICAO DOC 8643 designator — the type the flight record already carries
 * (`aircraftType`, e.g. "A21N").
 *
 * Two questions turn on it:
 * - **Multi-pilot time.** Every sector on a type certificated for two pilots
 *   is multi-pilot, whoever the record names in the seats — an airline sector
 *   imported without its co-pilot is still a two-crew flight.
 * - **Solo.** Nobody flies an A320 solo. Solo time on a two-pilot type is an
 *   error in the record, where on a C172 it is ordinary.
 *
 * It is a LIST, not a rule, because no field of the type data says it: wake
 * category and engine type both have exceptions (the Citation CJ4 is a medium
 * jet certificated for a single pilot; the Dash 8 is a turboprop that needs
 * two). The list covers the transport and large business types; anything not
 * on it answers `null` — unknown — and the record's own crew decides instead.
 * It is pure so the server's schema and the client agree.
 */

import type { AdditionalCrew, FlightLog } from "@/types/entities/flight.types"

const TWO_PILOT_TYPES: RegExp[] = [
  /^A(30|31|32|33|34|35|38)[0-9A-Z]$/, // Airbus A300 … A380 (A320 family, A330, A350 …)
  /^A(19|20|21)N$/, //                     A319neo / A320neo / A321neo
  /^BCS[13]$/, //                          A220
  /^B7\d[\dA-Z]$/, //                      Boeing 7x7 (B738, B77W, B789 …)
  /^B3[7-9X]M$/, //                        737 MAX
  /^E(1[1-9]\d|2[9]\d|75[LS])$/, //        Embraer E-Jets, ERJ, Brasilia
  /^AT[4-7]\d$/, //                        ATR 42 / 72 (not the AT5T-style Air Tractors)
  /^DH8[A-D]$/, //                         Dash 8
  /^CRJ[0-9X]$/, //                        CRJ
  /^F(28|50|70|100)$/, //                  Fokker
  /^(B46[123]|RJ70|RJ85|RJ1H)$/, //        BAe 146 / Avro RJ
  /^(MD\d\d|DC\d{1,2}|DC\d[0-9A-Z])$/, //  McDonnell Douglas
  /^(SF34|SB20)$/, //                      Saab 340 / 2000
  /^(C919|C909|AJ27|SU95)$/, //            COMAC, Superjet
  /^(GLF[2-6]|GA[5-8]C|GLEX|GL[5-8]T|CL30|CL35|CL60|F900|F2TH|FA[5-8]X)$/, // large business jets
]

/** 2 when the type is certificated for two pilots, `null` when this list cannot say. */
export function minimumPilots(aircraftType: string | undefined | null): 2 | null {
  const type = (aircraftType ?? "").trim().toUpperCase()
  if (!type) return null
  return TWO_PILOT_TYPES.some((re) => re.test(type)) ? 2 : null
}

/** A type a single pilot cannot legally fly. */
export function requiresTwoPilots(aircraftType: string | undefined | null): boolean {
  return minimumPilots(aircraftType) === 2
}

// ── Crew beyond the two seats ─────────────────────────────────────────────

/**
 * The roles a third (or later) crew member can hold, in picker order. The
 * stored values are the original ones; only "Relief Pilot" is new, and it is
 * the one that makes a flight multi-pilot on its own (`isMultiPilotFlight`).
 */
export const ADDITIONAL_CREW_ROLES: { value: AdditionalCrew["role"]; label: string }[] = [
  { value: "Relief Pilot", label: "Relief pilot" },
  { value: "Check Airman", label: "Check pilot" },
  { value: "Instructor", label: "Instructor" },
  { value: "Examiner", label: "Examiner" },
  { value: "Observer", label: "Observer" },
  { value: "Other", label: "Other" },
]

export function additionalCrewRoleLabel(role: AdditionalCrew["role"]): string {
  return ADDITIONAL_CREW_ROLES.find((r) => r.value === role)?.label ?? role
}

/**
 * The flight's additional crew with `member` added — or `null` when they are
 * already aboard, in either seat or the list, so picking someone twice cannot
 * put them on the flight twice. The crew card's id is the entry's id (the
 * signature step looks the licence up by it).
 */
export function withAdditionalCrew(
  flight: Pick<FlightLog, "picId" | "sicId" | "additionalCrew">,
  member: { id: string; name: string },
  role: AdditionalCrew["role"] = "Relief Pilot"
): AdditionalCrew[] | null {
  const current = flight.additionalCrew ?? []
  if (member.id === flight.picId || member.id === flight.sicId) return null
  if (current.some((c) => c.id === member.id)) return null
  return [...current, { id: member.id, name: member.name, role }]
}
