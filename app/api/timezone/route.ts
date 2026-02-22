/**
 * Timezone lookup from coordinates via geo-tz
 *
 * GET /api/timezone?lat=1.3644&lng=103.9915
 */

import { NextResponse } from "next/server"
import { find } from "geo-tz"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const lat = parseFloat(searchParams.get("lat") || "")
  const lng = parseFloat(searchParams.get("lng") || "")

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ tz: "" })
  }

  try {
    const timezones = find(lat, lng)
    return NextResponse.json({ tz: timezones[0] || "" })
  } catch (error) {
    console.error("[Timezone] Lookup failed:", error)
    return NextResponse.json({ tz: "" })
  }
}
