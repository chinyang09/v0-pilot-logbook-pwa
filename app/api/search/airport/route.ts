/**
 * Server-side proxy for FR24 airport lookup
 * Bypasses CORS restrictions on the unofficial FR24 API
 *
 * GET /api/search/airport?q=WARR
 */

import { NextResponse } from "next/server"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get("q")

  if (!query || query.length < 3) {
    return NextResponse.json({ result: null })
  }

  try {
    const fr24Url = `https://www.flightradar24.com/airports/traffic-stats/?airport=${encodeURIComponent(query.toUpperCase())}`
    const response = await fetch(fr24Url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      return NextResponse.json({ result: null })
    }

    const data = await response.json()
    const details = data?.details

    if (!details?.code?.icao) {
      return NextResponse.json({ result: null })
    }

    const result = {
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

    return NextResponse.json({ result })
  } catch (error) {
    console.error("[FR24 Airport Search] Failed:", error)
    return NextResponse.json({ result: null })
  }
}
