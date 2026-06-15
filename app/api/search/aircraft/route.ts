/**
 * Server-side proxy for FR24 aircraft search
 * Bypasses CORS restrictions on the unofficial FR24 API
 *
 * GET /api/search/aircraft?q=9V-TNL
 * GET /api/search/aircraft?q=9V-TNL&debug=1   ← surfaces the upstream payload
 */

import { NextResponse } from "next/server"
import { fr24Find, type FR24Hit } from "@/lib/fr24/find"

// Run on Vercel's Edge runtime. Edge fetch uses a different TLS stack than
// Node, so its JA3/JA4 fingerprint differs — Cloudflare's bot-fight rules on
// FR24's /v1/* endpoint reject Node's fetch with a 403 JS-challenge HTML page,
// and Edge sometimes slips past. If this still 403s, escalate to a Cloudflare
// Worker / paid scraper proxy (the only real options against Cloudflare JS
// interstitials — no header tweak can solve them).
export const runtime = "edge"

// Force this route to run per-request — no Next.js fetch cache, no ISR.
export const dynamic = "force-dynamic"
export const revalidate = 0
export const fetchCache = "force-no-store"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get("q")
  // Debug surfaces raw upstream response bodies — only honour it when explicitly
  // enabled by the operator, never for arbitrary callers in production.
  const debug = process.env.FR24_DEBUG === "1" && searchParams.get("debug") === "1"

  if (!query || query.length < 2) {
    return NextResponse.json({ results: [] })
  }

  // Try the user's literal query first (matches what FR24's website search bar
  // actually sends — case- and dash-preserving). If that returns nothing, fall
  // back to a normalized variant (lowercase, no dashes) as belt-and-suspenders.
  const variants = Array.from(
    new Set([query, query.replace(/[-\s]/g, "").toLowerCase()])
  )

  const attempts: any[] = []
  let finalResults: FR24Hit[] = []

  for (const variant of variants) {
    const attempt = await fr24Find(variant)
    attempts.push({
      variant,
      via: attempt.via,
      ok: attempt.ok,
      status: attempt.status,
      contentType: attempt.contentType,
      bodyLength: attempt.bodyLength,
      hits: attempt.results.length,
      stats: attempt.data?.stats?.count ?? null,
      error: attempt.error,
      bodySnippet: attempt.bodySnippet,
    })

    console.log(
      "[FR24 Search]",
      JSON.stringify({
        variant,
        via: attempt.via,
        ok: attempt.ok,
        status: attempt.status,
        contentType: attempt.contentType,
        bodyLength: attempt.bodyLength,
        hits: attempt.results.length,
        stats: attempt.data?.stats?.count ?? null,
        error: attempt.error,
      })
    )

    if (attempt.results.length > 0) {
      finalResults = attempt.results
      break
    }
  }

  if (debug) {
    return NextResponse.json({ results: finalResults, debug: { query, attempts } })
  }

  return NextResponse.json({ results: finalResults })
}
