/**
 * Aircraft enrichment (server-only, NODE).
 *
 * The lookup is handed to the Edge door (`lookupFromEdge`) — the upstream
 * challenges the Node runtime, so calling the Worker from here failed for
 * every aircraft. It asks the Worker's `/aircraft` chain (search → the
 * registration's flight history → the live feed). Also hydrates with ICAO
 * DOC 8643 type data when the type code is known.
 *
 * THREE outcomes, and callers must keep them apart: `unavailable` (the lookup
 * could not be made — a challenge, a timeout, no route to the door) is not
 * evidence the aircraft is unknown. Counting it as `not_found` is what burnt
 * every pending submission's retries while the lookups were failing.
 */

import { getICAOTypeByDesignator } from "@/lib/icao-types/icao-types-server"
import { lookupFromEdge } from "@/lib/lookup/handoff"
import { normalizeRegistration } from "@/lib/utils/string"

export interface EnrichedAircraftData {
  registration: string
  icao24: string
  typecode: string
  operator: string
  source: "fr24"
  shortDescription: string
  wtc: string
  wtg: string
  manufacturerCode: string
}

export type AircraftEnrichment =
  | { status: "found"; data: EnrichedAircraftData }
  | { status: "not_found" }
  | { status: "unavailable"; error: string }

/**
 * Look up a registration. Pass the user's `request` when there is one (a
 * submission): the door is then reached on this deployment's own origin.
 */
export async function enrichAircraftFromFR24(
  registration: string,
  request?: Request
): Promise<AircraftEnrichment> {
  const answer = await lookupFromEdge("aircraft", { reg: registration }, { request })
  if (!answer.ok) {
    return answer.status === 404 ? { status: "not_found" } : { status: "unavailable", error: answer.error }
  }

  // The chain lists exact matches first; prefer one, as the search route does.
  const wanted = normalizeRegistration(registration)
  const aircraft = answer.data.find((a) => normalizeRegistration(a.registration) === wanted) ?? answer.data[0]
  if (!aircraft) return { status: "not_found" }

  const typecode = aircraft.typecode || ""
  const typeInfo = getICAOTypeByDesignator(typecode)

  return {
    status: "found",
    data: {
      registration: aircraft.registration || registration,
      icao24: aircraft.icao24 || "",
      typecode,
      operator: aircraft.operator || "",
      source: "fr24",
      shortDescription: typeInfo?.description || "",
      wtc: typeInfo?.wtc || "",
      wtg: typeInfo?.wtg || "",
      manufacturerCode: typeInfo?.manufacturerCode || "",
    },
  }
}
