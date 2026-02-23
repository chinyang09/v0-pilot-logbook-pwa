/**
 * FR24 aircraft enrichment (server-only)
 *
 * Reuses the same FR24 proxy logic from /api/search/aircraft
 * but as a reusable function for submission enrichment.
 * Also hydrates with ICAO DOC 8643 type data when typecode is known.
 */

import { getICAOTypeByDesignator } from "@/lib/icao-types/icao-types-server"

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
 * Attempt to enrich an aircraft registration via FR24 search API.
 * If a typecode is found, also hydrates with ICAO DOC 8643 type data.
 * Returns enriched data if found, null otherwise.
 */
export async function enrichAircraftFromFR24(
  registration: string
): Promise<EnrichedAircraftData | null> {
  try {
    const url = `https://www.flightradar24.com/v1/search/web/find?query=${encodeURIComponent(registration)}&limit=10`
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) return null

    const data = await response.json()
    const aircraft = data.results?.find(
      (r: any) => r.type === "aircraft"
    )

    if (!aircraft) return null

    const typecode = aircraft.detail?.equip || ""

    // Hydrate with ICAO DOC 8643 type data
    const typeInfo = getICAOTypeByDesignator(typecode)

    return {
      registration: aircraft.id || registration,
      icao24: aircraft.detail?.hex || "",
      typecode,
      operator: aircraft.detail?.owner || "",
      source: "fr24",
      shortDescription: typeInfo?.description || "",
      wtc: typeInfo?.wtc || "",
      wtg: typeInfo?.wtg || "",
      manufacturerCode: typeInfo?.manufacturerCode || "",
    }
  } catch {
    return null
  }
}
