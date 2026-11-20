/**
 * Runways and frequencies for a few airports — NODE (MongoDB).
 *
 * GET /api/lookup/airport-info?ids=WSSS,VTBS
 *
 * aviationweather.gov's airport data, kept 30 days per airport
 * (`lib/weather/airport-info.ts`) — one upstream request for whatever is not
 * kept yet. A static segment, so it routes before the door's catch-all;
 * behind a sign-in like the weather. Browser callers use `lookup.airportInfo`.
 */

import { NextResponse } from "next/server"
import { validateSession } from "@/lib/auth/server/session"
import { getDB } from "@/lib/mongodb/client"
import { AIRPORT_INFO_MAX_IDS, getAirportInfo, mongoAirportInfoStore } from "@/lib/weather/airport-info"
import { isStationId } from "@/lib/weather/types"

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
  ].slice(0, AIRPORT_INFO_MAX_IDS)
  if (ids.length === 0) return NextResponse.json({ ok: false, error: "Give airport ids" }, { status: 400 })

  try {
    const data = await getAirportInfo(ids, { store: mongoAirportInfoStore(await getDB()) })
    // Reference data: a browser may keep it for a day — but only a COMPLETE
    // answer. A source that failed leaves ids out, and kept for a day that
    // partial answer was what the browser read back on every retry: a duty
    // chosen with a new destination drew no runways until the page was left
    // and reopened (the owner's report).
    const complete = ids.every((id) => id in data)
    return NextResponse.json(
      { ok: true, data },
      { headers: { "cache-control": complete ? "private, max-age=86400" : "no-store" } },
    )
  } catch (e) {
    console.error("[AirportInfo] lookup failed:", e)
    return NextResponse.json({ ok: false, error: "Airport info unavailable" }, { status: 503 })
  }
}
