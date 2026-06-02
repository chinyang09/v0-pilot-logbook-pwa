/**
 * FR24 search proxy — Cloudflare Worker (plain JS, dashboard-friendly)
 *
 * Proxies /v1/search/web/find requests to flightradar24.com from Cloudflare's
 * own network. Worker fetch carries a different TLS fingerprint than Node /
 * Vercel Edge, and Cloudflare → Cloudflare origin requests sometimes bypass
 * the bot challenge that 403s direct server-side fetches.
 *
 * Optional env var:
 *   PROXY_SECRET — if set, requests must include `x-proxy-secret: <value>`.
 *   Set the same value in Vercel as FR24_PROXY_SECRET.
 */

const FR24_HOST = "https://www.flightradar24.com"
const ALLOWED_PATHS = ["/v1/search/web/find"]

export default {
  async fetch(request, env) {
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
        cf: { cacheTtl: 0, cacheEverything: false },
      })

      const contentType = upstreamRes.headers.get("content-type") || ""
      const body = await upstreamRes.text()

      if (!upstreamRes.ok || !contentType.includes("application/json")) {
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
          message: err && err.message ? err.message : String(err),
          name: err && err.name ? err.name : "Error",
        },
        502
      )
    }
  },
}

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  })
}
