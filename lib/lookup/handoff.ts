/**
 * A reference lookup from NODE server code, handed to the Edge door
 * (`/api/lookup/[...path]`) instead of calling the gateway Worker directly.
 *
 * The upstream scores whoever calls the Worker and challenges the Node
 * runtime on every endpoint (measured 29 Oct 2026), so a Node route that calls
 * the Worker itself gets a 502 for every aircraft. Over this hop the Worker's
 * caller is the Edge function, which is answered.
 *
 * Where the door is:
 *   - with a `request` (a user's request, e.g. a submission): this deployment's
 *     own origin, with the user's cookies forwarded. On a preview that cookie
 *     is what gets past Vercel's deployment protection.
 *   - without one (the cron): the production domain, which deployment
 *     protection does not cover.
 * `x-lookup-secret` tells the door this is server code, and Vercel's
 * automation-bypass header is added when the project defines one.
 *
 * Never throws. Same envelope as `callFr24Worker`: 404 = nothing found, 502
 * (or 0) = the lookup could not be made, which a caller must NOT count as
 * "not found".
 */

import { readEnvelope, setQuery } from "@/lib/fr24/envelope"
import type { Fr24Result } from "@/lib/fr24/types"
import type { LookupRoute, LookupRoutes } from "./types"

const HANDOFF_TIMEOUT_MS = 15000

/** The origin to reach the door at, or null when there is none to use. */
export function handoffOrigin(request?: Request): string | null {
  if (request) {
    try {
      return new URL(request.url).origin
    } catch {
      // fall through to the production domain
    }
  }
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL
  if (production) return `https://${production.replace(/^https?:\/\//, "").replace(/\/$/, "")}`
  return null
}

export async function lookupFromEdge<R extends LookupRoute>(
  route: R,
  params: Record<string, string | number | undefined>,
  options: { request?: Request; timeoutMs?: number } = {}
): Promise<Fr24Result<LookupRoutes[R]>> {
  const origin = handoffOrigin(options.request)
  if (!origin) return { ok: false, status: 0, error: "No origin to reach the lookup route" }

  const url = setQuery(new URL(`/api/lookup/${route}`, origin), params)

  const headers: Record<string, string> = { accept: "application/json" }
  const secret = process.env.FR24_PROXY_SECRET
  if (secret) headers["x-lookup-secret"] = secret
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  if (bypass) headers["x-vercel-protection-bypass"] = bypass
  const cookie = options.request?.headers.get("cookie")
  if (cookie) headers.cookie = cookie

  try {
    const response = await fetch(url, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? HANDOFF_TIMEOUT_MS),
    })
    // A non-JSON answer is deployment protection's sign-in page or a platform
    // error — the lookup was not made, so it reads as 502, never as 404.
    return readEnvelope<LookupRoutes[R]>(response.status, await response.json().catch(() => null))
  } catch (err) {
    return { ok: false, status: 0, error: `${(err as Error).name}: ${(err as Error).message}` }
  }
}
