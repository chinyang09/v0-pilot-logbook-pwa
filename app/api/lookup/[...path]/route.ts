/**
 * The app's door to the reference-lookup gateway Worker — EDGE runtime.
 *
 * GET /api/lookup/airport?code=WSSS
 * GET /api/lookup/aircraft/flights?reg=9V-TNL&page=1
 * GET /api/lookup/aircraft/candidates?q=9VB
 * … any normalized Worker route (`LOOKUP_ROUTES`), passed through, or one the
 * door composes from them (`lib/lookup/composite.ts`). The browser helpers are
 * in `lib/lookup/client.ts`, the shapes in `lib/lookup/types.ts`, and server
 * code reaches it through `lookupFromEdge` (`lib/lookup/handoff.ts`).
 *
 * This is the app's ONE online-lookup surface. `/api/search/*` (the per-kind
 * routes it grew out of) is gone; the shared MongoDB pool is the two Node
 * routes beside this one, `/api/lookup/pool/{aircraft,airport}`, which a
 * static segment routes before this catch-all.
 *
 * WHY EDGE: the upstream scores whoever calls the Worker, and challenges the
 * Node runtime's calls on every endpoint (measured 29 Oct 2026; see
 * `cloudflare-worker/README.md`). Node routes that need a lookup hand it to
 * this route instead of calling the Worker themselves.
 *
 * Who may call it — every call spends the Worker's daily quota:
 *   - server code, with `x-lookup-secret` (the Worker secret, never in a
 *     browser) — the enrichment routes, including the cron, which has no user;
 *   - a signed-in user. The session lives in MongoDB, which Edge cannot read,
 *     so the user's cookies are forwarded to `/api/auth/session` on this same
 *     origin. On a preview the browser's Vercel sign-in cookie goes along,
 *     which is what gets that call past deployment protection.
 *
 * The Worker's secret stays on the server, and `/raw` and `/probe` are not
 * reachable (an open passthrough, and an operator's diagnostic).
 *
 * Answers the Worker's own envelope and status: 200 `{ ok, data, source }`,
 * 404 nothing found, 502 every upstream source failed.
 */

import { NextResponse } from "next/server"
import { callFr24Worker, fr24WorkerConfigured } from "@/lib/fr24/worker-client"
import type { Fr24Route } from "@/lib/fr24/types"
import { COMPOSITE_ROUTE_NAMES, isCompositeRoute, runCompositeRoute } from "@/lib/lookup/composite"

export const runtime = "edge"
export const dynamic = "force-dynamic"

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
])

function isLookupRoute(route: string): route is Fr24Route {
  return LOOKUP_ROUTES.has(route as Fr24Route)
}

/** Constant-time string comparison (no `crypto.timingSafeEqual` on Edge). */
function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

type Caller = "server" | "user" | "anonymous" | "unknown"

async function identifyCaller(request: Request): Promise<Caller> {
  const secret = process.env.FR24_PROXY_SECRET || ""
  if (sameSecret(request.headers.get("x-lookup-secret") || "", secret)) return "server"

  const cookie = request.headers.get("cookie")
  if (!cookie || !/(?:^|;\s*)session=/.test(cookie)) return "anonymous"
  try {
    const response = await fetch(new URL("/api/auth/session", request.url), {
      headers: { cookie, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return "unknown"
    const body = (await response.json().catch(() => null)) as { authenticated?: boolean } | null
    return body?.authenticated === true ? "user" : "anonymous"
  } catch {
    return "unknown"
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const caller = await identifyCaller(request)
  if (caller === "anonymous") {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }
  if (caller === "unknown") {
    return NextResponse.json({ ok: false, error: "Session check unavailable" }, { status: 503 })
  }

  const { path } = await params
  const route = path.join("/")
  const composite = isCompositeRoute(route)
  if (!composite && !isLookupRoute(route)) {
    return NextResponse.json(
      { ok: false, error: "Unknown route", routes: [...LOOKUP_ROUTES, ...COMPOSITE_ROUTE_NAMES] },
      { status: 404 }
    )
  }
  if (!fr24WorkerConfigured()) {
    return NextResponse.json({ ok: false, error: "Lookup service not configured" }, { status: 503 })
  }

  const query: Record<string, string> = {}
  // `path` is Next's own catch-all parameter, which it also puts in the URL's
  // query; the Worker has no use for it.
  new URL(request.url).searchParams.forEach((value, key) => {
    if (key !== "debug" && key !== "path") query[key] = value
  })

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
