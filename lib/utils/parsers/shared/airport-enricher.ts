/**
 * Airport enrichment chain for bulk imports (CSV/PDF logbook + schedule).
 * Same shape as aircraft-enricher.ts, applied to airport codes.
 *
 *   1. Local IndexedDB (getAirportByIcao/getAirportByIata) — fast
 *   2. Server batch (POST /api/search/airport/batch) — MongoDB cache,
 *      filtered by enrichedAt freshness (180 day TTL)
 *   3. FR24 live (GET /api/search/airport?q=CODE) — per-code fallback, on
 *      the Edge runtime and FR24 only; a timezone it did not carry is
 *      derived from the coordinates (`deriveTimezone`), or it would be
 *      stored as "UTC"
 *
 * Results from steps 2 and 3 are written back to local IndexedDB as custom
 * airports, so the next import for the same code is fully local. FR24 hits
 * are also queued for fire-and-forget submission, which hydrates the
 * MongoDB cache for everyone else.
 *
 * Codes can be a mix of ICAO (4 chars) and IATA (3 chars) — the batch
 * endpoint matches either field.
 *
 * A code that has MOVED between airports (`lib/airports/code-changes.ts` —
 * VTZ, VOVZ → VOVI) is resolved through the airports it has meant: each of
 * their ICAOs goes through the chain and comes back as a key of its own, so a
 * caller picks the one a flight's DATE asks for (`pickAirportAt`). The code's
 * own key holds the airport it means today.
 *
 * And a code the device answers locally is checked against the shared pool
 * in the same request (`codeConflicts`): a pool that gives another airport for
 * it is how a move nobody has dated yet shows up. It is reported, never
 * applied — which airport a flight used depends on when it flew.
 */

import {
  getAirportByIcao,
  getAirportByIata,
  addCustomAirport,
} from "@/lib/db/stores/reference/airports.store"
import { submitAirportToServer } from "@/lib/submissions/submit"
import { createId } from "@/lib/auth/shared/cuid"
import { pooledForEach } from "./pooled-map"
import { deriveTimezone } from "@/lib/airports/online-lookup"
import { icaoForIataAt, icaosForIata, isReassignedIata } from "@/lib/airports/code-changes"
import type { Airport } from "@/types/entities/airport.types"

export interface EnrichAirportProgress {
  current: number
  total: number
  code: string
  stage: "local" | "server-batch" | "fr24"
}

/** A code this device and the shared pool resolve to DIFFERENT airports. */
export interface AirportCodeConflict {
  code: string
  localIcao: string
  poolIcao: string
}

export interface EnrichAirportResult {
  /** Map of original input code → resolved Airport. Includes whatever was
   *  already in local IndexedDB as well as freshly-enriched entries, and the
   *  ICAO keys of every airport a moved code has meant. */
  enriched: Map<string, Airport>
  /** Codes that no source could resolve. */
  failedCodes: string[]
  /** Locally resolved codes the shared pool answers with another airport. */
  codeConflicts: AirportCodeConflict[]
  stats: {
    localHits: number
    serverBatchHits: number
    fr24Hits: number
    failed: number
  }
}

type EnrichedAirportPayload = {
  icao: string
  iata: string
  name: string
  city: string
  country: string
  countryCode: string
  latitude: number
  longitude: number
  elevation: number
  timezone: string
}

async function localLookup(code: string): Promise<Airport | undefined> {
  const c = code.toUpperCase()
  // ICAO is 4 chars, IATA is 3 chars — try the more likely one first.
  if (c.length === 4) {
    const byIcao = await getAirportByIcao(c)
    if (byIcao) return byIcao
    return getAirportByIata(c)
  }
  if (c.length === 3) {
    const byIata = await getAirportByIata(c)
    if (byIata) return byIata
    return getAirportByIcao(c)
  }
  // Fallback: try both
  return (await getAirportByIcao(c)) || (await getAirportByIata(c))
}

async function persistEnriched(payload: EnrichedAirportPayload): Promise<Airport> {
  const submissionId = createId()
  const airport = await addCustomAirport({
    icao: payload.icao,
    iata: payload.iata,
    name: payload.name,
    city: payload.city,
    state: "",
    country: payload.country,
    latitude: payload.latitude,
    longitude: payload.longitude,
    elevation: payload.elevation,
    tz: payload.timezone || "UTC",
    submissionId,
  })
  return airport
}

export async function enrichAirportBatch(
  codes: string[],
  onProgress?: (p: EnrichAirportProgress) => void
): Promise<EnrichAirportResult> {
  const enriched = new Map<string, Airport>()
  const stats = { localHits: 0, serverBatchHits: 0, fr24Hits: 0, failed: 0 }

  if (codes.length === 0) {
    return { enriched, failedCodes: [], codeConflicts: [], stats }
  }

  const requested = codes.map((c) => c.trim().toUpperCase()).filter(Boolean)
  // A moved code is resolved through the airports it has meant, never asked
  // about by itself: online, the code alone answers with one of them, and
  // which one is exactly the question the date has to settle.
  const uniqueCodes = Array.from(
    new Set(requested.flatMap((c) => (isReassignedIata(c) ? icaosForIata(c) : [c])))
  )
  const movedCodes = Array.from(new Set(requested.filter(isReassignedIata)))

  // ---------- 1. Local IndexedDB ----------
  for (const code of uniqueCodes) {
    const hit = await localLookup(code)
    if (hit) {
      enriched.set(code, hit)
      stats.localHits++
    }
  }

  let remaining = uniqueCodes.filter((c) => !enriched.has(c))
  // IATA codes answered here, to compare with the pool's answer.
  const toCheck = uniqueCodes.filter((c) => c.length === 3 && enriched.has(c))
  const codeConflicts: AirportCodeConflict[] = []

  // ---------- 2. Server batch (MongoDB cache) ----------
  if (remaining.length > 0 || toCheck.length > 0) {
    try {
      const batchRes = await fetch("/api/search/airport/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codes: [...remaining, ...toCheck] }),
        signal: AbortSignal.timeout(8000),
      })

      if (batchRes.ok) {
        const { results } = await batchRes.json()
        const resultMap = (results || {}) as Record<string, EnrichedAirportPayload>

        for (const code of toCheck) {
          const pooled = resultMap[code]?.icao?.toUpperCase()
          const local = enriched.get(code)?.icao?.toUpperCase()
          if (pooled && local && pooled !== local) {
            codeConflicts.push({ code, localIcao: local, poolIcao: pooled })
          }
        }

        for (const code of remaining) {
          const match = resultMap[code]
          if (!match) continue

          try {
            const airport = await persistEnriched(match)
            enriched.set(code, airport)
            stats.serverBatchHits++
          } catch {
            // addCustomAirport can race with itself — if it failed, try a
            // local re-lookup since another caller may have just written it.
            const refetched = await localLookup(code)
            if (refetched) {
              enriched.set(code, refetched)
              stats.serverBatchHits++
            }
          }
        }
      }
    } catch {
      // Server unreachable — fall through to FR24.
    }

    remaining = remaining.filter((c) => !enriched.has(c))
  }

  // ---------- 3. FR24 live, per-code ----------
  const failedCodes: string[] = []
  if (remaining.length > 0) {
    let done = 0
    // Bounded — see `pooled-map.ts`. A career's logbook touches far more
    // airports than one roster does.
    await pooledForEach(remaining, async (code) => {
        try {
          const res = await fetch(
            `/api/search/airport?q=${encodeURIComponent(code)}`,
            { signal: AbortSignal.timeout(12000) }
          )

          if (!res.ok) {
            failedCodes.push(code)
            stats.failed++
            return
          }

          const data = await res.json()
          const found = data?.result as EnrichedAirportPayload | null
          const match = found?.icao ? await deriveTimezone(found) : null

          if (!match || !match.icao) {
            failedCodes.push(code)
            stats.failed++
            return
          }

          const airport = await persistEnriched(match)
          enriched.set(code, airport)
          stats.fr24Hits++

          // Fire-and-forget — hydrates MongoDB cache for other users.
          submitAirportToServer({
            submissionId: airport.submissionId || createId(),
            icao: match.icao,
            iata: match.iata,
            name: match.name,
            city: match.city,
            country: match.country,
            timezone: match.timezone,
            latitude: match.latitude,
            longitude: match.longitude,
            elevation: match.elevation,
          })
        } catch {
          failedCodes.push(code)
          stats.failed++
        } finally {
          done++
          onProgress?.({
            current: done,
            total: remaining.length,
            code,
            stage: "fr24",
          })
        }
      }
    )
  }

  // A moved code's own key is the airport it means today.
  for (const code of movedCodes) {
    const current = icaoForIataAt(code)
    const airport = current ? enriched.get(current) : undefined
    if (airport) enriched.set(code, airport)
    else if (!failedCodes.includes(code)) failedCodes.push(code)
  }

  return { enriched, failedCodes, codeConflicts, stats }
}

/** The import warning for a code the device and the shared pool disagree on. */
export function codeConflictMessage(conflict: AirportCodeConflict): string {
  return (
    `${conflict.code} is ${conflict.localIcao} on this device, but the shared airport list now has it as ` +
    `${conflict.poolIcao}. If the code has moved to a new airport, flights after the move are filed at the ` +
    `old one — check their airports.`
  )
}
