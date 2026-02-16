/**
 * Client-side submission helpers
 *
 * Fire-and-forget functions that submit custom aircraft/airports
 * to the server for enrichment and sharing with all users.
 * Failures are silently ignored (offline-first — local data is always available).
 */

import { getUserSession } from "@/lib/db"

/**
 * Submit a custom aircraft to the server for enrichment.
 * Non-blocking: errors are logged but don't affect the caller.
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
    if (!session?.sessionToken) return

    const res = await fetch("/api/submissions/aircraft", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.sessionToken}`,
      },
      body: JSON.stringify(params),
    })

    if (!res.ok) {
      console.warn("[Submissions] Aircraft submission failed:", res.status)
      return
    }

    const { data } = await res.json()
    if (data?.status === "enriched" && data.enrichedData) {
      console.log("[Submissions] Aircraft enriched:", data.enrichedData.registration)
      // Future: update local record with enriched data + reconcile flights
    }
  } catch {
    // Offline or network error — silently ignore
  }
}

/**
 * Submit a custom airport to the server for enrichment.
 * Non-blocking: errors are logged but don't affect the caller.
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
    if (!session?.sessionToken) return

    const res = await fetch("/api/submissions/airport", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.sessionToken}`,
      },
      body: JSON.stringify(params),
    })

    if (!res.ok) {
      console.warn("[Submissions] Airport submission failed:", res.status)
      return
    }

    const { data } = await res.json()
    if (data?.status === "enriched" && data.enrichedData) {
      console.log("[Submissions] Airport enriched:", data.enrichedData.icao)
    }
  } catch {
    // Offline or network error — silently ignore
  }
}
