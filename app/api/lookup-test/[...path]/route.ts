/**
 * The operator's TEST door to the gateway Worker — EDGE runtime, NO sign-in.
 *
 * GET /api/lookup-test/probe?explore=1&airline=TGW&airlineIata=TR
 * GET /api/lookup-test/aircraft/candidates?q=9VO
 * GET /api/lookup-test/<any route /api/lookup serves>
 *
 * Why it exists: the upstream scores whoever CALLS the Worker, and a probe
 * run from a laptop, a phone app or a cloud sandbox measures that caller, not
 * the app. The app's routes call from Vercel's Edge runtime, so this is where
 * the Worker's `/probe` has to be run to say what the APP can reach. It answers
 * exactly what `/api/lookup` answers (`lib/lookup/door.ts`), without the
 * sign-in, plus the Worker's `/probe` — never `/raw`.
 *
 * Who can reach it: it is OFF in production (404) unless `LOOKUP_TEST_ROUTE=1`
 * is set there. On a preview deployment it sits behind Vercel's deployment
 * protection, so only someone signed in to the Vercel team (or holding a share
 * link) gets to it — the app's own sign-in is what it skips, not Vercel's.
 */

import { NextResponse } from "next/server"
import { fetchFr24Worker } from "@/lib/fr24/worker-client"
import { answerLookup, lookupQuery } from "@/lib/lookup/door"

export const runtime = "edge"
export const dynamic = "force-dynamic"

/** The probe asks every upstream once, in parallel; give it the room. */
const PROBE_TIMEOUT_MS = 25000

function enabled(): boolean {
  return process.env.VERCEL_ENV !== "production" || process.env.LOOKUP_TEST_ROUTE === "1"
}

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if (!enabled()) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 })

  const { path } = await params
  const route = path.join("/")
  if (route !== "probe") return answerLookup(request, route)

  const probe = await fetchFr24Worker("probe", lookupQuery(request), PROBE_TIMEOUT_MS)
  return NextResponse.json(
    {
      // Which caller the probe measured: this Edge function, in this region.
      ranFrom: { runtime: "edge", region: request.headers.get("x-vercel-id")?.split(":")[0] ?? null },
      workerStatus: probe.status,
      ...(probe.error ? { error: probe.error } : {}),
      probe: probe.body,
    },
    { status: probe.status >= 200 && probe.status < 300 ? 200 : 502, headers: { "cache-control": "no-store" } }
  )
}
