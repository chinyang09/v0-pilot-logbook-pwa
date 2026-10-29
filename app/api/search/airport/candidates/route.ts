/**
 * The airports a typed code could mean — EDGE runtime.
 *
 * GET /api/search/airport/candidates?q=VOV
 *
 * `/api/search/airport` answers ONE airport for a whole code; the add-airport
 * form also needs the question before that one — "VOV" could be VOVI or VOVZ,
 * and a pilot who half-remembers a code chooses rather than being handed the
 * first. Read off the Worker's `/search` (`airportCandidates`): either code,
 * or the name when the query is no code, exact first. A candidate carries the
 * codes and name only; the form looks the chosen one up in full through the
 * usual chain, which is what carries the timezone.
 *
 * WHY EDGE: the upstream scores whoever calls the Worker and challenges the
 * Node runtime (see `cloudflare-worker/README.md`).
 */

import { NextResponse } from "next/server"
import { callFr24Worker, fr24WorkerConfigured } from "@/lib/fr24/worker-client"
import { airportCandidates } from "@/lib/lookup/search-candidates"

export const runtime = "edge"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() || ""
  if (query.length < 2 || !fr24WorkerConfigured()) return NextResponse.json({ results: [] })
  const search = await callFr24Worker("search", { q: query, limit: 30 }, 7000)
  return NextResponse.json({ results: search.ok ? airportCandidates(search.data, query) : [] })
}
