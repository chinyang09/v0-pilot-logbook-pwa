/**
 * FR24 search proxy — Cloudflare Worker
 *
 * Proxies /v1/search/web/find requests to flightradar24.com from Cloudflare's
 * own network. Worker fetch carries a different TLS fingerprint than Node /
 * Vercel Edge, and Cloudflare → Cloudflare origin requests sometimes bypass
 * the bot challenge that 403s direct server-side fetches.
 *
 * Deploy: see README.md in this directory.
 *
 * Usage from the Next.js route:
 *   fetch(`${env.FR24_PROXY_URL}?query=9vtnl&limit=10`)
 *
 * The Worker returns the upstream FR24 JSON verbatim, or a small JSON object
 * { error, status, contentType, body } if the upstream request didn't return
 * JSON (so the caller can still diagnose).
 */

export interface Env {
  /**
   * Optional shared secret. If set, the Worker rejects requests that don't
   * carry a matching `x-proxy-secret` header. Set the same value as the
   * `FR24_PROXY_SECRET` env var in Vercel to avoid open-internet abuse of
   * your free Workers quota.
   */
  PROXY_SECRET?: string
}

const FR24_HOST = "https://www.flightradar24.com"
const ALLOWED_PATHS = ["/v1/search/web/find"]

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405)
    }

    if (env.PROXY_SECRET) {
      const provided = request.headers.get("x-proxy-secret")
      if (provided !== env.PROXY_SECRET) {
        return json({ error: "Unauthorized" }, 401)
      }
    }

    const url = new URL(request.url)
    // Worker path mirrors FR24's path; only allow the search path we proxy.
    const path = url.pathname === "/" ? "/v1/search/web/find" : url.pathname
    if (!ALLOWED_PATHS.includes(path)) {
      return json({ error: "Path not allowed", path }, 400)
    }

    const upstream = new URL(FR24_HOST + path)
    upstream.search = url.search

    try {
      const upstreamRes = await fetch(upstream.toString(), {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
          "Referer": "https://www.flightradar24.com/",
        },
        // Cloudflare Workers caching off; FR24 search results change frequently.
        cf: { cacheTtl: 0, cacheEverything: false },
      })

      const contentType = upstreamRes.headers.get("content-type") || ""
      const body = await upstreamRes.text()

      if (!upstreamRes.ok || !contentType.includes("application/json")) {
        // Surface the upstream error to the caller so the Next.js route can
        // log it. Status 502 makes it obvious this came from the Worker, not
        // a Worker-side bug.
        return json(
          {
            error: "Upstream non-JSON or non-OK",
            status: upstreamRes.status,
            contentType,
            bodyLength: body.length,
            bodySnippet: body.slice(0, 500),
          },
          502
        )
      }

      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "access-control-allow-origin": "*",
        },
      })
    } catch (err) {
      return json(
        {
          error: "Fetch failed",
          message: (err as Error).message,
          name: (err as Error).name,
        },
        502
      )
    }
  },
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  })
}
