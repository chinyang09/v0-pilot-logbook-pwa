/**
 * FR24 aircraft enrichment (server-only)
 *
 * Reuses the same FR24 proxy logic from /api/search/aircraft
 * but as a reusable function for submission enrichment.
 */

export interface EnrichedAircraftData {
  registration: string
  icao24: string
  typecode: string
  operator: string
  source: "fr24"
}

/**
 * Attempt to enrich an aircraft registration via FR24 search API.
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

    return {
      registration: aircraft.id || registration,
      icao24: aircraft.detail?.hex || "",
      typecode: aircraft.detail?.equip || "",
      operator: aircraft.detail?.owner || "",
      source: "fr24",
    }
  } catch {
    return null
  }
}
