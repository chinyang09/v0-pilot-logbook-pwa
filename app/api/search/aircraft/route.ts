/**
 * Server-side proxy for FR24 aircraft search
 * Bypasses CORS restrictions on the unofficial FR24 API
 *
 * GET /api/search/aircraft?q=9vtnk
 */

import { NextResponse } from "next/server"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get("q")

  if (!query || query.length < 2) {
    return NextResponse.json({ results: [] })
  }

  // FR24's web search index appears case-sensitive on prefix matching —
  // browser hits send lowercase. The form sends uppercase (e.g. "9V-TNL").
  // Lowercase + dash-strip mirrors the working browser query (`?query=9vtnl`).
  const normalized = query.replace(/[-\s]/g, "").toLowerCase()
  if (normalized.length < 2) {
    return NextResponse.json({ results: [] })
  }

  const fr24Url = `https://www.flightradar24.com/v1/search/web/find?query=${encodeURIComponent(normalized)}&limit=10`

  try {
    const response = await fetch(fr24Url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.flightradar24.com/",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
        "x-fetch": "true",
      },
      signal: AbortSignal.timeout(5000),
    })

    const contentType = response.headers.get("content-type") || ""
    const body = await response.text()

    if (!response.ok) {
      console.error(
        "[FR24 Search] non-OK",
        response.status,
        contentType,
        body.slice(0, 500)
      )
      return NextResponse.json({ results: [] })
    }

    if (!contentType.includes("application/json")) {
      // Cloudflare challenge HTML, or anything else non-JSON
      console.error(
        "[FR24 Search] non-JSON response",
        response.status,
        contentType,
        body.slice(0, 500)
      )
      return NextResponse.json({ results: [] })
    }

    const data = body ? JSON.parse(body) : {}

    // Extract aircraft-type results only
    const aircraftResults =
      data.results
        ?.filter((r: any) => r.type === "aircraft")
        ?.map((r: any) => ({
          registration: r.id || "",
          icao24: r.detail?.hex || "",
          typecode: r.detail?.equip || "",
          operator: r.detail?.owner || "",
          source: "fr24" as const,
        })) || []

    if (aircraftResults.length === 0) {
      console.log(
        "[FR24 Search] empty result",
        normalized,
        "stats:",
        JSON.stringify(data?.stats?.count ?? null)
      )
    }

    return NextResponse.json({ results: aircraftResults })
  } catch (error) {
    console.error("[FR24 Search] Failed:", error)
    return NextResponse.json({ results: [] })
  }
}
