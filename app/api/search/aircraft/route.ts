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

  try {
    const fr24Url = `https://www.flightradar24.com/v1/search/web/find?query=${encodeURIComponent(query)}&limit=10`
    const response = await fetch(fr24Url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      return NextResponse.json({ results: [] })
    }

    const data = await response.json()

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

    return NextResponse.json({ results: aircraftResults })
  } catch (error) {
    console.error("[FR24 Search] Failed:", error)
    return NextResponse.json({ results: [] })
  }
}
