/**
 * Runway geometry for a few airports — NODE (MongoDB).
 *
 * GET /api/lookup/runways?ids=WSSS,VTBS
 *
 * OurAirports' thresholds, true headings, elevations and displaced
 * thresholds, one stored document per airport (`lib/runways/server.ts`): a
 * primary-key read of the few airports asked, never the dataset. A store a
 * week behind the source is refreshed AFTER this answer is sent, by the one
 * request that wins the lock. Behind a sign-in; callers use `lookup.runways`.
 */

import { after, NextResponse } from "next/server"
import { validateSession } from "@/lib/auth/server/session"
import { getDB } from "@/lib/mongodb/client"
import { getRunways, mongoRunwayStore, RUNWAYS_MAX_IDS } from "@/lib/runways/server"
import { isStationId } from "@/lib/weather/types"

// The refresh after the answer reads a ~4MB file and writes what changed.
export const maxDuration = 60

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
  ].slice(0, RUNWAYS_MAX_IDS)
  if (ids.length === 0) return NextResponse.json({ ok: false, error: "Give airport ids" }, { status: 400 })

  try {
    const store = mongoRunwayStore(await getDB())
    const answer = await getRunways(ids, {
      store,
      schedule: (refresh) =>
        after(() =>
          refresh().then(
            (r) => console.warn("[Runways] refreshed:", r),
            (e) => console.error("[Runways] refresh failed:", e),
          ),
        ),
    })
    // Reference data: a browser may keep a COMPLETE answer for a day; one from
    // a store not loaded yet is not kept anywhere.
    return NextResponse.json(
      { ok: true, data: answer },
      { headers: { "cache-control": answer.loaded ? "private, max-age=86400" : "no-store" } },
    )
  } catch (e) {
    console.error("[Runways] lookup failed:", e)
    return NextResponse.json({ ok: false, error: "Runways unavailable" }, { status: 503 })
  }
}
