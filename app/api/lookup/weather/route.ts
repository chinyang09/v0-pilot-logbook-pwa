/**
 * METAR and TAF for a handful of stations — NODE (MongoDB, zlib).
 *
 * GET /api/lookup/weather?ids=WSSS,VTCC[&fresh=1]
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

  const params = new URL(request.url).searchParams
  // `fresh=1` is the pilot's Refresh: a snapshot over two minutes old is
  // pulled again, and nothing in between (the browser's cache) answers it.
  const fresh = params.get("fresh") === "1"
  const ids = [
    ...new Set(
      (params.get("ids") ?? "")
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(isStationId),
    ),
  ].slice(0, WEATHER_MAX_IDS)
  if (ids.length === 0) return NextResponse.json({ ok: false, error: "Give station ids" }, { status: 400 })

  try {
    const data = await getWeather(ids, { store: mongoWeatherStore(await getDB()), fresh })
    // Never kept by the browser: a Refresh answered from its HTTP cache was
    // the same weather again with nothing saying so (the owner's report).
    // SWR's dedupe already keeps a repeated ask from reaching the server.
    return NextResponse.json({ ok: true, data }, { headers: { "cache-control": "no-store" } })
  } catch (e) {
    console.error("[Weather] lookup failed:", e)
    return NextResponse.json({ ok: false, error: "Weather unavailable" }, { status: 503 })
  }
}
