/**
 * What the lookup door does once a caller is admitted: route the request to
 * the gateway Worker (a normalized route passed through) or to a route the
 * door composes (`composite.ts`), and answer in one envelope — 200
 * `{ ok, data, source }`, 404 nothing found, 502 the lookup could not be made.
 *
 * Shared by `/api/lookup` (signed-in users and server code) and
 * `/api/lookup-test` (the operator's test door, no sign-in), so the two can
 * never answer differently. Who may call is each route's own business.
 */

import { NextResponse } from "next/server"
import { callFr24Worker, fr24WorkerConfigured } from "@/lib/fr24/worker-client"
import type { Fr24Route } from "@/lib/fr24/types"
import { COMPOSITE_ROUTE_NAMES, isCompositeRoute, runCompositeRoute } from "./composite"

const LOOKUP_ROUTES: ReadonlySet<Fr24Route> = new Set<Fr24Route>([
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
  "airline/fleet",
  "airline/routes",
  "airline/routes/from",
])

export const DOOR_ROUTES: readonly string[] = [...LOOKUP_ROUTES, ...COMPOSITE_ROUTE_NAMES]

function isLookupRoute(route: string): route is Fr24Route {
  return LOOKUP_ROUTES.has(route as Fr24Route)
}

/** The request's query, less Next's catch-all parameter and `debug`. */
export function lookupQuery(request: Request): Record<string, string> {
  const query: Record<string, string> = {}
  // `path` is Next's own catch-all parameter, which it also puts in the URL's
  // query; the Worker has no use for it.
  new URL(request.url).searchParams.forEach((value, key) => {
    if (key !== "debug" && key !== "path") query[key] = value
  })
  return query
}

export async function answerLookup(request: Request, route: string): Promise<Response> {
  const composite = isCompositeRoute(route)
  if (!composite && !isLookupRoute(route)) {
    return NextResponse.json({ ok: false, error: "Unknown route", routes: DOOR_ROUTES }, { status: 404 })
  }
  if (!fr24WorkerConfigured()) {
    return NextResponse.json({ ok: false, error: "Lookup service not configured" }, { status: 503 })
  }

  const query = lookupQuery(request)
  const answer = composite ? await runCompositeRoute(route, query) : await callFr24Worker(route as Fr24Route, query)
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
