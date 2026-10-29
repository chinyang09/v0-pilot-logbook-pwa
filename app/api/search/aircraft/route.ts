/**
 * Server-side proxy for the aircraft lookup — EDGE runtime.
 *
 * GET /api/search/aircraft?q=9VB
 * GET /api/search/aircraft?q=9V-TNL&debug=1   ← surfaces the gateway's answer
 *
 * Answers EVERY aircraft the query could mean (`aircraftCandidates`): the
 * Worker's `/search` (FR24's search, every kind of hit — an airframe, or a
 * live flight flying it), exact first, then the registrations the query
 * begins, then those it is inside. Each carries `exact`, and only an exact one
 * may be taken without the pilot choosing it: "9VB" is a question, not an
 * answer.
 *
 * Search does not index every airframe, so when nothing it returned IS the
 * query and the query is long enough to be a whole registration, the
 * registration's flight history is asked as well (`aircraft/flights`), which
 * knows an aeroplane by its full mark. It replaced a single `/aircraft` call,
 * which kept only `type: "aircraft"` hits and was read as one answer.
 *
 * WHY EDGE: the upstream scores whoever calls the Worker and challenges the
 * Node runtime (see `cloudflare-worker/README.md`).
 *
 * Answers `{ results }`, each in the shape the callers have always read plus
 * `exact`.
 */

import { NextResponse } from "next/server"
import { callFr24Worker, fr24WorkerConfigured } from "@/lib/fr24/worker-client"
import { aircraftCandidates, type AircraftCandidate } from "@/lib/lookup/search-candidates"
import { normalizeRegistration } from "@/lib/utils/string"

export const runtime = "edge"

// Force this route to run per-request — no Next.js fetch cache, no ISR.
export const dynamic = "force-dynamic"
export const revalidate = 0
export const fetchCache = "force-no-store"

/** A whole registration is rarely under five characters once the dash goes. */
const WHOLE_REGISTRATION = 5

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get("q")?.trim()
  // Debug surfaces the gateway's status and error — only honour it when
  // explicitly enabled by the operator, never for arbitrary callers.
  const debug = process.env.FR24_DEBUG === "1" && searchParams.get("debug") === "1"

  if (!query || query.length < 2 || !fr24WorkerConfigured()) {
    return NextResponse.json({ results: [] })
  }

  const search = await callFr24Worker("search", { q: query, limit: 30 }, 7000)
  let results: AircraftCandidate[] = search.ok ? aircraftCandidates(search.data, query) : []

  let history: { status: number; source?: string; error?: string } | undefined
  const exact = results.some((r) => r.exact)
  if (!exact && (normalizeRegistration(query).length >= WHOLE_REGISTRATION || results.length === 0)) {
    const answer = await callFr24Worker("aircraft/flights", { reg: query, limit: 1 }, 7000)
    history = { status: answer.status, source: answer.ok ? answer.source : undefined, error: answer.ok ? undefined : answer.error }
    const aircraft = answer.ok ? answer.data.aircraft : null
    if (aircraft && normalizeRegistration(aircraft.registration) === normalizeRegistration(query)) {
      results = [
        {
          registration: aircraft.registration,
          icao24: aircraft.icao24,
          typecode: aircraft.typecode,
          operator: aircraft.operator,
          source: "fr24",
          exact: true,
        },
        ...results,
      ]
    }
  }

  if (debug) {
    return NextResponse.json({
      results,
      debug: {
        query,
        search: { status: search.status, source: search.ok ? search.source : undefined, error: search.ok ? undefined : search.error },
        history,
      },
    })
  }
  return NextResponse.json({ results })
}
