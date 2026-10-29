/**
 * The PWA's door to the FR24 gateway Worker.
 *
 * GET /api/fr24/airport?code=WSSS
 * GET /api/fr24/aircraft/flights?reg=9V-TNL&page=1
 * … any normalized Worker route (`FR24_ROUTES`); the browser helpers are in
 * `lib/fr24/client.ts` and the shapes in `lib/fr24/types.ts`.
 *
 * The Worker's secret stays here — a browser calling the Worker directly
 * would have to carry it. Signed-in users only, since every call spends the
 * Worker's daily quota; `/raw` and `/probe` are deliberately not reachable
 * (an open FR24 passthrough, and an operator's diagnostic).
 *
 * Answers the Worker's own envelope and status: 200 `{ ok, data, source }`,
 * 404 nothing found, 502 every upstream source failed.
 */

import { NextResponse } from "next/server"
import { SessionStoreUnavailableError, validateRequestSession } from "@/lib/auth/server/session"
import { callFr24Worker, fr24WorkerConfigured } from "@/lib/fr24/worker-client"
import type { Fr24Route } from "@/lib/fr24/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const FR24_ROUTES: ReadonlySet<Fr24Route> = new Set<Fr24Route>([
  "aircraft",
  "aircraft/flights",
  "airport",
  "airport/details",
  "airport/schedule",
  "airports",
  "airlines",
  "search",
  "flight",
  "flight/details",
  "live",
])

function isFr24Route(route: string): route is Fr24Route {
  return FR24_ROUTES.has(route as Fr24Route)
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const session = await validateRequestSession(request)
    if (!session) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
    }
  } catch (err) {
    if (err instanceof SessionStoreUnavailableError) {
      return NextResponse.json({ ok: false, error: "Session store unavailable" }, { status: 503 })
    }
    throw err
  }

  const { path } = await params
  const route = path.join("/")
  if (!isFr24Route(route)) {
    return NextResponse.json({ ok: false, error: "Unknown route", routes: [...FR24_ROUTES] }, { status: 404 })
  }
  if (!fr24WorkerConfigured()) {
    return NextResponse.json({ ok: false, error: "Lookup service not configured" }, { status: 503 })
  }

  const query: Record<string, string> = {}
  new URL(request.url).searchParams.forEach((value, key) => {
    if (key !== "debug") query[key] = value
  })

  const answer = await callFr24Worker(route, query)
  if (answer.ok) {
    return NextResponse.json(
      { ok: true, data: answer.data, source: answer.source },
      { headers: { "cache-control": "private, max-age=60" } }
    )
  }
  // A 0 is a timeout or an unreachable Worker — say 502, same as every
  // upstream failing, so the caller reads it as "try later".
  const status = answer.status >= 400 ? answer.status : 502
  return NextResponse.json({ ok: false, error: answer.error }, { status })
}
