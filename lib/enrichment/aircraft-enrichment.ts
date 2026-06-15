/**
 * FR24 aircraft enrichment (server-only)
 *
 * Reuses the same FR24 proxy logic from /api/search/aircraft
 * but as a reusable function for submission enrichment.
 * Also hydrates with ICAO DOC 8643 type data when typecode is known.
 */

import { getICAOTypeByDesignator } from "@/lib/icao-types/icao-types-server"
import { fr24Find } from "@/lib/fr24/find"

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

/**
 * Attempt to enrich an aircraft registration via FR24 search.
 * Routes through the shared proxy-aware client so enrichment succeeds in the
 * same proxied environments the search route was engineered for (previously
 * this hit flightradar24.com directly and silently failed behind Cloudflare).
 * If a typecode is found, also hydrates with ICAO DOC 8643 type data.
 * Returns enriched data if found, null otherwise.
 */
export async function enrichAircraftFromFR24(
  registration: string
): Promise<EnrichedAircraftData | null> {
  const result = await fr24Find(registration)
  const aircraft = result.results[0]
  if (!aircraft) return null

  const typecode = aircraft.typecode || ""

  // Hydrate with ICAO DOC 8643 type data
  const typeInfo = getICAOTypeByDesignator(typecode)

  return {
    registration: aircraft.registration || registration,
    icao24: aircraft.icao24 || "",
    typecode,
    operator: aircraft.operator || "",
    source: "fr24",
    shortDescription: typeInfo?.description || "",
    wtc: typeInfo?.wtc || "",
    wtg: typeInfo?.wtg || "",
    manufacturerCode: typeInfo?.manufacturerCode || "",
  }
}
