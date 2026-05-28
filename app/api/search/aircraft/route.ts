/**
 * Server-side proxy for FR24 aircraft search
 * Bypasses CORS restrictions on the unofficial FR24 API
 *
 * GET /api/search/aircraft?q=9V-TNL
 * GET /api/search/aircraft?q=9V-TNL&debug=1   ← surfaces the upstream payload
 */

import { NextResponse } from "next/server"

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
}> {
  // Match the airport route's minimal header set — it's known to work
  // server-side. Adding Sec-Fetch-* / x-fetch headers from a non-browser
  // origin can actually trip Cloudflare's bot-fight rules since the TLS
  // fingerprint won't match what a real browser would send alongside them.
  const fr24Url = `https://www.flightradar24.com/v1/search/web/find?query=${encodeURIComponent(query)}&limit=10`

  try {
    const response = await fetch(fr24Url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json, text/plain, */*",
      },
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
