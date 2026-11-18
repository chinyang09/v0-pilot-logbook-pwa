/**
 * METAR and TAF for a handful of stations — NODE (MongoDB, zlib).
 *
 * GET /api/lookup/weather?ids=WSSS,VTCC
 *
 * Answered from the weather cache (`lib/weather/server.ts`): one snapshot of
 * every station's reports, pulled from aviationweather.gov's cache files on
 * demand at most every ten minutes. A static segment, so it routes before the
 * door's catch-all; behind a sign-in, because a refresh spends the source's
 * goodwill. Browser callers go through `lookup.weather`.
 */

import { NextResponse } from "next/server"
import { validateSession } from "@/lib/auth/server/session"
import { getDB } from "@/lib/mongodb/client"
import { getWeather, mongoWeatherStore } from "@/lib/weather/server"
import { isStationId, WEATHER_MAX_IDS } from "@/lib/weather/types"

export async function GET(request: Request) {
  const session = await validateSession().catch(() => undefined)
  if (session === undefined) return NextResponse.json({ ok: false, error: "Session store unavailable" }, { status: 503 })
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })

  const ids = [
    ...new Set(
      (new URL(request.url).searchParams.get("ids") ?? "")
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(isStationId),
    ),
  ].slice(0, WEATHER_MAX_IDS)
  if (ids.length === 0) return NextResponse.json({ ok: false, error: "Give station ids" }, { status: 400 })

  try {
    const data = await getWeather(ids, { store: mongoWeatherStore(await getDB()) })
    return NextResponse.json(
      { ok: true, data },
      // Two minutes in the browser: a refresh tapped twice is one request.
      { headers: { "cache-control": "private, max-age=120" } },
    )
  } catch (e) {
    console.error("[Weather] lookup failed:", e)
    return NextResponse.json({ ok: false, error: "Weather unavailable" }, { status: 503 })
  }
}
