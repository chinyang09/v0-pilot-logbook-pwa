/**
 * Server-side proxy for FR24 aircraft search
 * Bypasses CORS restrictions on the unofficial FR24 API
 *
 * GET /api/search/aircraft?q=9V-TNL
 * GET /api/search/aircraft?q=9V-TNL&debug=1   ← surfaces the upstream payload
 */

import { NextResponse } from "next/server"

// Run on Vercel's Edge runtime. Edge fetch uses a different TLS stack than
// Node, so its JA3/JA4 fingerprint differs — Cloudflare's bot-fight rules on
// FR24's /v1/* endpoint reject Node's fetch with a 403 JS-challenge HTML page,
// and Edge sometimes slips past. If this still 403s, escalate to a Cloudflare
// Worker / paid scraper proxy (the only real options against Cloudflare JS
// interstitials — no header tweak can solve them).
export const runtime = "edge"

// Force this route to run per-request — no Next.js fetch cache, no ISR.
export const dynamic = "force-dynamic"
export const revalidate = 0
export const fetchCache = "force-no-store"

type FR24Hit = {
  registration: string
  icao24: string
  typecode: string
  operator: string
  source: "fr24"
}

async function fetchFr24(query: string): Promise<{
  ok: boolean
  status: number
  contentType: string
  bodyLength: number
  bodySnippet: string
  data: any
  results: FR24Hit[]
  error?: string
  via: "direct" | "worker"
}> {
  // When FR24_PROXY_URL is set, route through the Cloudflare Worker
  // (see cloudflare-worker/). Worker fetch lives on Cloudflare's network
  // with a different TLS fingerprint, so it can sometimes bypass the
  // bot-fight 403 that direct Node/Edge fetch hits. The Worker preserves
  // the FR24 path (/v1/search/web/find) and the query string.
  const proxyUrl = process.env.FR24_PROXY_URL
  const proxySecret = process.env.FR24_PROXY_SECRET
  const via: "direct" | "worker" = proxyUrl ? "worker" : "direct"

  const upstreamUrl = proxyUrl
    ? `${proxyUrl.replace(/\/$/, "")}/v1/search/web/find?query=${encodeURIComponent(query)}&limit=10`
    : `https://www.flightradar24.com/v1/search/web/find?query=${encodeURIComponent(query)}&limit=10`

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
        results: [],
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
        results: [],
        error: `JSON parse failed: ${(err as Error).message}`,
        via,
      }
    }

    const results: FR24Hit[] = Array.isArray(data?.results)
      ? data.results
          .filter((r: any) => r && r.type === "aircraft")
          .map((r: any) => ({
            registration: r.id || "",
            icao24: r.detail?.hex || "",
            typecode: r.detail?.equip || "",
            operator: r.detail?.owner || "",
            source: "fr24" as const,
          }))
      : []

    return {
      ok: true,
      status: response.status,
      contentType,
      bodyLength: body.length,
      bodySnippet: body.slice(0, 500),
      data,
      results,
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
      results: [],
      error: `fetch threw: ${(err as Error).name}: ${(err as Error).message}`,
      via,
    }
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get("q")
  const debug = searchParams.get("debug") === "1"

  if (!query || query.length < 2) {
    return NextResponse.json({ results: [] })
  }

  // Try the user's literal query first (matches what FR24's website search bar
  // actually sends — case- and dash-preserving). If that returns nothing, fall
  // back to a normalized variant (lowercase, no dashes) as belt-and-suspenders.
  const variants = Array.from(
    new Set([query, query.replace(/[-\s]/g, "").toLowerCase()])
  )

  const attempts: any[] = []
  let finalResults: FR24Hit[] = []

  for (const variant of variants) {
    const attempt = await fetchFr24(variant)
    attempts.push({
      variant,
      via: attempt.via,
      ok: attempt.ok,
      status: attempt.status,
      contentType: attempt.contentType,
      bodyLength: attempt.bodyLength,
      hits: attempt.results.length,
      stats: attempt.data?.stats?.count ?? null,
      error: attempt.error,
      bodySnippet: attempt.bodySnippet,
    })

    console.log(
      "[FR24 Search]",
      JSON.stringify({
        variant,
        via: attempt.via,
        ok: attempt.ok,
        status: attempt.status,
        contentType: attempt.contentType,
        bodyLength: attempt.bodyLength,
        hits: attempt.results.length,
        stats: attempt.data?.stats?.count ?? null,
        error: attempt.error,
      })
    )

    if (attempt.results.length > 0) {
      finalResults = attempt.results
      break
    }
  }

  if (debug) {
    return NextResponse.json({ results: finalResults, debug: { query, attempts } })
  }

  return NextResponse.json({ results: finalResults })
}
