/**
 * The FR24 airport lookup, from the EDGE runtime.
 *
 * GET /api/search/airport/edge?q=WBGG
 *
 * Under test. FR24 judges whoever calls the gateway Worker — for a Worker's
 * subrequest Cloudflare scores the ORIGINAL caller's connection — and the
 * Worker's logs show calls from this runtime passing (the aircraft search is
 * Edge) while calls from Node (`/api/search/airport`) are challenged on every
 * endpoint. This route is the Node route's FR24 step and nothing else: no
 * MongoDB cache and no timezone derivation, neither of which runs on Edge.
 *
 * Answers `{ result, source }` like `/api/search/airport`, plus the Worker's
 * `status` and `error` when there is no result.
 */

import { NextResponse } from "next/server"
import { callFr24Worker, fr24WorkerConfigured } from "@/lib/fr24/worker-client"

export const runtime = "edge"
export const dynamic = "force-dynamic"
export const revalidate = 0
export const fetchCache = "force-no-store"

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim().toUpperCase()
  if (!query || query.length < 3) {
    return NextResponse.json({ result: null, source: null })
  }
  if (!fr24WorkerConfigured()) {
    return NextResponse.json({ result: null, source: null, error: "FR24_PROXY_URL is not set" }, { status: 503 })
  }

  const answer = await callFr24Worker("airport", { code: query })
  if (answer.ok) {
    const { timezoneOffsetSeconds: _offset, ...result } = answer.data
    return NextResponse.json({ result, source: "fr24", tier: answer.source })
  }
  return NextResponse.json({ result: null, source: null, status: answer.status, error: answer.error })
}
