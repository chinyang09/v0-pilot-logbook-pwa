/**
 * Shared FR24 aircraft search client (server-only, runtime-agnostic).
 *
 * Used by the Edge search proxy (app/api/search/aircraft) AND the Node
 * enrichment helper (lib/enrichment) so both honour the same Cloudflare-Worker
 * proxy (FR24_PROXY_URL / FR24_PROXY_SECRET). Uses only fetch + AbortSignal so
 * it is safe in both the Edge and Node runtimes.
 */

export type FR24Hit = {
  registration: string
  icao24: string
  typecode: string
  operator: string
  source: "fr24"
}

export interface FR24FindResult {
  ok: boolean
  status: number
  contentType: string
  bodyLength: number
  bodySnippet: string
  data: any
  results: FR24Hit[]
  error?: string
  via: "direct" | "worker"
}

const FR24_TIMEOUT_MS = 8000

export async function fr24Find(query: string): Promise<FR24FindResult> {
  // When FR24_PROXY_URL is set, route through the Cloudflare Worker
  // (see cloudflare-worker/). Worker fetch lives on Cloudflare's network with a
  // different TLS fingerprint, so it can bypass the bot-fight 403 that direct
  // Node/Edge fetch hits. The Worker preserves the FR24 path + query string.
  const proxyUrl = process.env.FR24_PROXY_URL
  const proxySecret = process.env.FR24_PROXY_SECRET
  const via: "direct" | "worker" = proxyUrl ? "worker" : "direct"

  const upstreamUrl = proxyUrl
    ? `${proxyUrl.replace(/\/$/, "")}/v1/search/web/find?query=${encodeURIComponent(query)}&limit=10`
    : `https://www.flightradar24.com/v1/search/web/find?query=${encodeURIComponent(query)}&limit=10`

  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json, text/plain, */*",
  }
  if (proxyUrl && proxySecret) {
    headers["x-proxy-secret"] = proxySecret
  }

  try {
    const response = await fetch(upstreamUrl, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(FR24_TIMEOUT_MS),
    })

    const contentType = response.headers.get("content-type") || ""
    const body = await response.text()

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        contentType,
        bodyLength: body.length,
        bodySnippet: body.slice(0, 500),
        data: null,
        results: [],
        error: `HTTP ${response.status}`,
        via,
      }
    }

    let data: any = null
    try {
      data = body ? JSON.parse(body) : null
    } catch (err) {
      return {
        ok: true,
        status: response.status,
        contentType,
        bodyLength: body.length,
        bodySnippet: body.slice(0, 500),
        data: null,
        results: [],
        error: `JSON parse failed: ${(err as Error).message}`,
        via,
      }
    }

    const results: FR24Hit[] = Array.isArray(data?.results)
      ? data.results
          .filter((r: any) => r && r.type === "aircraft")
          .map((r: any) => ({
            registration: r.id || "",
            icao24: r.detail?.hex || "",
            typecode: r.detail?.equip || "",
            operator: r.detail?.owner || "",
            source: "fr24" as const,
          }))
      : []

    return {
      ok: true,
      status: response.status,
      contentType,
      bodyLength: body.length,
      bodySnippet: body.slice(0, 500),
      data,
      results,
      via,
    }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      contentType: "",
      bodyLength: 0,
      bodySnippet: "",
      data: null,
      results: [],
      error: `fetch threw: ${(err as Error).name}: ${(err as Error).message}`,
      via,
    }
  }
}
