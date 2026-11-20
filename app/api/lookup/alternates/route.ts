/**
 * The aerodromes a duty could divert to, with their weather — NODE (MongoDB).
 *
 * GET /api/lookup/alternates?path=1.36,103.99;13.68,100.75&dests=13.68,100.75&exclude=WSSS,VTBS
 *
 * `path` is the duty's airports in the order flown, `dests` the ones it lands
 * at that are worth a "nearby" list; both as lat,lon. The candidates are the
 * TAF aerodromes in the weather snapshot (`readGeoIndex`), chosen by
 * `pickAlternates`, and their METAR and TAF come from the same snapshot by
 * projection — no request to the source this route makes on its own.
 */

import { NextResponse } from "next/server"
import { validateSession } from "@/lib/auth/server/session"
import { getDB } from "@/lib/mongodb/client"
import { getWeather, mongoWeatherStore, readGeoIndex } from "@/lib/weather/server"
import { pickAlternates } from "@/lib/weather/alternates"
import { isStationId, WEATHER_MAX_IDS } from "@/lib/weather/types"
import type { LatLon } from "@/lib/utils/geo"

const points = (raw: string | null): LatLon[] =>
  (raw ?? "")
    .split(";")
    .map((p) => p.split(",").map(Number))
    .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180)
    .slice(0, 8)
    .map(([lat, lon]) => ({ lat, lon }))

export async function GET(request: Request) {
  const session = await validateSession().catch(() => undefined)
  if (session === undefined) return NextResponse.json({ ok: false, error: "Session store unavailable" }, { status: 503 })
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })

  const params = new URL(request.url).searchParams
  const path = points(params.get("path"))
  const dests = points(params.get("dests")).slice(0, 3)
  if (path.length < 1) return NextResponse.json({ ok: false, error: "Give the route" }, { status: 400 })
  const exclude = new Set(
    (params.get("exclude") ?? "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(isStationId),
  )

  try {
    const store = mongoWeatherStore(await getDB())
    const index = await readGeoIndex(store)
    const alternates = pickAlternates(index, path, dests, exclude).slice(0, WEATHER_MAX_IDS)
    const weather = alternates.length
      ? await getWeather(
          alternates.map((a) => a.icao),
          { store },
        )
      : null
    return NextResponse.json({ ok: true, data: { alternates, weather } }, { headers: { "cache-control": "no-store" } })
  } catch (e) {
    console.error("[Alternates] lookup failed:", e)
    return NextResponse.json({ ok: false, error: "Alternates unavailable" }, { status: 503 })
  }
}
