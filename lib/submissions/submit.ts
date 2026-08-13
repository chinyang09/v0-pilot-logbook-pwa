/**
 * Client-side submission helpers
 *
 * Fire-and-forget functions that submit custom aircraft/airports
 * to the server for enrichment and sharing with all users.
 * Failures are silently ignored (offline-first — local data is always available).
 *
 * When enriched data comes back, reconciliation runs automatically
 * to update affected flights (canonical registration, typecode, night time, etc.).
 */

import { getUserSession } from "@/lib/db"
import { reconcileFlightsForAircraft } from "@/lib/reconciliation/aircraft-reconciliation"
import { reconcileFlightsForAirport } from "@/lib/reconciliation/airport-reconciliation"
import { syncService } from "@/lib/sync"

/**
 * Submit a custom aircraft to the server for enrichment.
 * Non-blocking: errors are logged but don't affect the caller.
 * If enriched data is returned, automatically reconciles affected flights.
 */
export async function submitAircraftToServer(params: {
  submissionId: string
  registration: string
  typecode?: string
  icao24?: string
  operator?: string
}): Promise<void> {
  try {
    const session = await getUserSession()
    if (!session) return

    const res = await fetch("/api/submissions/aircraft", {
      method: "POST",
      // Authenticated by the HttpOnly session cookie, which the browser
      // attaches to this same-origin request on its own. No bearer token is
      // stored client-side to send — see `saveUserSession`.
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    })

    if (!res.ok) {
      console.warn("[Submissions] Aircraft submission failed:", res.status)
      return
    }

    const { data } = await res.json()
    if (data?.status === "enriched" && data.enrichedData) {
      console.log("[Submissions] Aircraft enriched:", data.enrichedData.registration)

      // Reconcile flights with enriched data
      const updated = await reconcileFlightsForAircraft(
        params.registration,
        {
          registration: data.enrichedData.registration,
          typecode: data.enrichedData.typecode,
        }
      )
      if (updated > 0) {
        syncService.notifyDataChange()
      }
    }
  } catch {
    // Offline or network error — silently ignore
  }
}

/**
 * Submit a custom airport to the server for enrichment.
 * Non-blocking: errors are logged but don't affect the caller.
 * If enriched data is returned, automatically reconciles affected flights.
 */
export async function submitAirportToServer(params: {
  submissionId: string
  icao: string
  name?: string
  iata?: string
  city?: string
  country?: string
  timezone?: string
  latitude?: number
  longitude?: number
  elevation?: number
}): Promise<void> {
  try {
    const session = await getUserSession()
    if (!session) return

    const res = await fetch("/api/submissions/airport", {
      method: "POST",
      // Authenticated by the HttpOnly session cookie, which the browser
      // attaches to this same-origin request on its own. No bearer token is
      // stored client-side to send — see `saveUserSession`.
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    })

    if (!res.ok) {
      console.warn("[Submissions] Airport submission failed:", res.status)
      return
    }

    const { data } = await res.json()
    if (data?.status === "enriched" && data.enrichedData) {
      console.log("[Submissions] Airport enriched:", data.enrichedData.icao)

      // Reconcile flights with enriched data
      const updated = await reconcileFlightsForAirport(
        params.icao,
        {
          latitude: data.enrichedData.latitude,
          longitude: data.enrichedData.longitude,
          timezone: data.enrichedData.timezone,
          iata: data.enrichedData.iata,
        }
      )
      if (updated > 0) {
        syncService.notifyDataChange()
      }
    }
  } catch {
    // Offline or network error — silently ignore
  }
}
