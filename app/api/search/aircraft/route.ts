/**
 * Server-side proxy for the aircraft lookup — EDGE runtime.
 *
 * GET /api/search/aircraft?q=9V-TNL
 * GET /api/search/aircraft?q=9V-TNL&debug=1   ← surfaces the gateway's answer
 *
 * One call to the gateway Worker's `/aircraft` chain: search → the
 * registration's flight history → the live feed. It replaced the legacy
 * search passthrough (`/v1/search/web/find`), which answered the same search
 * with the same fields (checked side by side, 29 Oct 2026) but could not tell
 * "no such aircraft" from "the lookup was challenged", and on a miss the
 * route then made up to three near-identical searches.
 *
 * WHY EDGE: the upstream scores whoever calls the Worker and challenges the
 * Node runtime (see `cloudflare-worker/README.md`).
 *
 * The search matches WHOLE registrations, with or without the dash (`9VOFH`
 * finds 9V-OFH) — not a prefix (`9VO` finds nothing).
 *
 * Answers `{ results }` in the shape the callers have always read.
 */

import { NextResponse } from "next/server"
import { callFr24Worker, fr24WorkerConfigured } from "@/lib/fr24/worker-client"

export const runtime = "edge"

// Force this route to run per-request — no Next.js fetch cache, no ISR.
export const dynamic = "force-dynamic"
export const revalidate = 0
export const fetchCache = "force-no-store"

type AircraftHit = {
  registration: string
  icao24: string
  typecode: string
  operator: string
  source: "fr24"
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get("q")?.trim()
  // Debug surfaces the gateway's status and error — only honour it when
  // explicitly enabled by the operator, never for arbitrary callers.
  const debug = process.env.FR24_DEBUG === "1" && searchParams.get("debug") === "1"

  if (!query || query.length < 2 || !fr24WorkerConfigured()) {
    return NextResponse.json({ results: [] })
  }

  const answer = await callFr24Worker("aircraft", { reg: query }, 7000)
  const results: AircraftHit[] = answer.ok
    ? answer.data.map((a) => ({
        registration: a.registration,
        icao24: a.icao24,
        typecode: a.typecode,
        operator: a.operator,
        source: "fr24" as const,
      }))
    : []

  if (debug) {
    return NextResponse.json({
      results,
      debug: { query, status: answer.status, source: answer.ok ? answer.source : undefined, error: answer.ok ? undefined : answer.error },
    })
  }
  return NextResponse.json({ results })
}
