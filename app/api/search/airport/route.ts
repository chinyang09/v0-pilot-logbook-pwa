/**
 * Server-side proxy for the FR24 airport lookup — EDGE runtime, FR24 only.
 *
 * GET /api/search/airport?q=WARR
 * GET /api/search/airport?q=WARR&debug=1   ← surfaces the upstream payload
 *
 * Lookup order:
 *   1. The FR24 gateway Worker's `/airport` (when FR24_PROXY_URL is set)
 *   2. traffic-stats directly — no Worker configured, or a Worker deployment
 *      that predates `/airport` (it answers that route 400)
 *
 * WHY EDGE: FR24 sits behind Cloudflare, and for a Worker's subrequest
 * Cloudflare scores the ORIGINAL caller's connection, not the Worker's. The
 * Worker's logs (29 Oct 2026) show calls from this runtime passing and calls
 * from the Node runtime challenged on every endpoint — the same Worker, the
 * same FR24 endpoints, the same region. This route was moved to Node on
 * 2 Jun 2026 to read the MongoDB cache, and that is what broke it.
 *
 * So nothing Node-only belongs here. The shared MongoDB pool is
 * `/api/search/airport/batch` (Node), asked FIRST by every caller through
 * `lookupAirportOnline` (`lib/airports/online-lookup.ts`), and a timezone the
 * source did not carry is derived there through `/api/timezone` (geo-tz).
 */

import { NextResponse } from "next/server"
import { callFr24Worker, fr24WorkerConfigured } from "@/lib/fr24/worker-client"
import type { EnrichedAirport } from "./shared"

export const runtime = "edge"
export const dynamic = "force-dynamic"
export const revalidate = 0
export const fetchCache = "force-no-store"

type AirportResult = EnrichedAirport

/**
 * The Worker's normalized `/airport`. `legacy: true` when the deployed Worker
 * predates that route, so the caller falls back to the passthrough.
 */
async function fetchViaWorker(query: string): Promise<{
  result: AirportResult | null
  legacy: boolean
  status: number
  source?: string
  error?: string
}> {
  const answer = await callFr24Worker("airport", { code: query })
  if (answer.ok) {
    const { timezoneOffsetSeconds: _offset, ...airport } = answer.data
    return { result: airport, legacy: false, status: answer.status, source: answer.source }
  }
  return {
    result: null,
    legacy: answer.status === 400 && /path not allowed/i.test(answer.error),
    status: answer.status,
    error: answer.error,
  }
}

async function fetchFr24Airport(query: string): Promise<{
  ok: boolean
  status: number
  contentType: string
  bodyLength: number
  bodySnippet: string
  data: any
  result: AirportResult | null
  error?: string
  via: "direct" | "worker"
}> {
  const proxyUrl = process.env.FR24_PROXY_URL
  const proxySecret = process.env.FR24_PROXY_SECRET
  const via: "direct" | "worker" = proxyUrl ? "worker" : "direct"

  const upstreamUrl = proxyUrl
    ? `${proxyUrl.replace(/\/$/, "")}/airports/traffic-stats/?airport=${encodeURIComponent(query)}`
    : `https://www.flightradar24.com/airports/traffic-stats/?airport=${encodeURIComponent(query)}`

  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json, text/plain, */*",
  }
  if (proxyUrl && proxySecret) {
    headers["x-proxy-secret"] = proxySecret
  }

  try {
    const response = await fetch(upstreamUrl, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    })

    const contentType = response.headers.get("content-type") || ""
    const body = await response.text()

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        contentType,
        bodyLength: body.length,
        bodySnippet: body.slice(0, 500),
        data: null,
        result: null,
        error: `HTTP ${response.status}`,
        via,
      }
    }

    let data: any = null
    try {
      data = body ? JSON.parse(body) : null
    } catch (err) {
      return {
        ok: true,
        status: response.status,
        contentType,
        bodyLength: body.length,
        bodySnippet: body.slice(0, 500),
        data: null,
        result: null,
        error: `JSON parse failed: ${(err as Error).message}`,
        via,
      }
    }

    const details = data?.details
    if (!details?.code?.icao) {
      return {
        ok: true,
        status: response.status,
        contentType,
        bodyLength: body.length,
        bodySnippet: body.slice(0, 500),
        data,
        result: null,
        via,
      }
    }

    const result: AirportResult = {
      icao: details.code.icao || "",
      iata: details.code.iata || "",
      name: details.name || "",
      city: details.position?.region?.city || "",
      country: details.position?.country?.name || "",
      countryCode: details.position?.country?.code || "",
      latitude: details.position?.latitude ?? 0,
      longitude: details.position?.longitude ?? 0,
      elevation: details.position?.altitude ?? 0,
      timezone: details.timezone?.name || "",
    }

    return {
      ok: true,
      status: response.status,
      contentType,
      bodyLength: body.length,
      bodySnippet: body.slice(0, 500),
      data,
      result,
      via,
    }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      contentType: "",
      bodyLength: 0,
      bodySnippet: "",
      data: null,
      result: null,
      error: `fetch threw: ${(err as Error).name}: ${(err as Error).message}`,
      via,
    }
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get("q")
  // Debug surfaces raw upstream payloads — gate behind an operator env flag so
  // arbitrary callers can't read upstream response bodies in production.
  const debug = process.env.FR24_DEBUG === "1" && searchParams.get("debug") === "1"

  if (!query || query.length < 3) {
    return NextResponse.json({ result: null })
  }

  const normalized = query.toUpperCase()

  // 1. The Worker's chain
  if (fr24WorkerConfigured()) {
    const viaWorker = await fetchViaWorker(normalized)
    if (!viaWorker.legacy) {
      const result = viaWorker.result
      console.log(
        "[Airport Search]",
        JSON.stringify({
          query,
          source: "worker",
          tier: viaWorker.source,
          status: viaWorker.status,
          hasResult: !!result,
          error: viaWorker.error,
        })
      )
      if (debug) {
        return NextResponse.json({
          result,
          source: result ? "fr24" : null,
          debug: { query, via: "worker", tier: viaWorker.source, status: viaWorker.status, error: viaWorker.error },
        })
      }
      return NextResponse.json({ result, source: result ? "fr24" : null })
    }
  }

  // 2. No Worker, or one without `/airport` → traffic-stats
  const attempt = await fetchFr24Airport(normalized)

  console.log(
    "[Airport Search]",
    JSON.stringify({
      query,
      source: "fr24",
      via: attempt.via,
      ok: attempt.ok,
      status: attempt.status,
      contentType: attempt.contentType,
      bodyLength: attempt.bodyLength,
      hasResult: !!attempt.result,
      error: attempt.error,
    })
  )

  if (debug) {
    return NextResponse.json({
      result: attempt.result,
      source: attempt.result ? "fr24" : null,
      debug: {
        query,
        via: attempt.via,
        ok: attempt.ok,
        status: attempt.status,
        contentType: attempt.contentType,
        bodyLength: attempt.bodyLength,
        bodySnippet: attempt.bodySnippet,
          error: attempt.error,
      },
    })
  }

  return NextResponse.json({
    result: attempt.result,
    source: attempt.result ? "fr24" : null,
  })
}
