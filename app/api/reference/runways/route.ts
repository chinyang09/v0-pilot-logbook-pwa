/**
 * Bring the runway geometry up to OurAirports' file — NODE, the weekly cron.
 *
 * GET /api/reference/runways[?force=1]   Authorization: Bearer $CRON_SECRET
 *
 * A conditional GET of the file: unchanged answers 304 and nothing is
 * written; a changed one rewrites only the airports whose runways moved
 * (`refreshRunways`). `force=1` reads the file even when the source says it
 * has not changed. Fails closed without `CRON_SECRET`.
 */

import { NextResponse } from "next/server"
import { getDB } from "@/lib/mongodb/client"
import { mongoRunwayStore, refreshRunways } from "@/lib/runways/server"

export const maxDuration = 60

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const force = new URL(request.url).searchParams.get("force") === "1"
  try {
    const result = await refreshRunways({ store: mongoRunwayStore(await getDB()), force })
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error("[Runways] refresh failed:", e)
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 })
  }
}
