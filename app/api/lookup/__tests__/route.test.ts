/**
 * /api/lookup — the Edge door to the gateway Worker. Server code gets in with
 * the server secret; a browser gets in only with a session the Node session
 * route confirms (Edge cannot read MongoDB); a session check that could not be
 * made is a 503, not a sign-out; the Worker's own statuses pass through; and
 * a composed route (`lib/lookup/composite.ts`) answers in the same envelope
 * behind the same rule.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { GET, runtime } from "../[...path]/route"

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

describe("GET /api/lookup/[...path]", () => {
  const calls: string[] = []
  let routes: Record<string, () => Response>

  beforeEach(() => {
    calls.length = 0
    routes = { "https://gw.test/": () => json({ ok: true, source: "search", data: [{ registration: "9V-TNL" }] }) }
    vi.stubEnv("FR24_PROXY_URL", "https://gw.test/")
    vi.stubEnv("FR24_PROXY_SECRET", "s3cret")
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        calls.push(url)
        const prefix = Object.keys(routes).find((p) => url.startsWith(p))
        return prefix ? routes[prefix]() : json({}, 404)
      })
    )
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  const call = (path: string[], headers: Record<string, string> = {}, query = "?reg=9V-TNL") =>
    GET(new Request(`https://app.test/api/lookup/${path.join("/")}${query}`, { headers }), {
      params: Promise.resolve({ path }),
    })

  it("runs on the Edge runtime", () => {
    expect(runtime).toBe("edge")
  })

  it("lets server code in with the secret, without asking for a session", async () => {
    const res = await call(["aircraft"], { "x-lookup-secret": "s3cret" })
    expect(res.status).toBe(200)
    expect(calls).toEqual(["https://gw.test/aircraft?reg=9V-TNL"])
  })

  it("does not forward Next's own catch-all parameter to the Worker", async () => {
    await call(["aircraft"], { "x-lookup-secret": "s3cret" }, "?reg=9V-TNL&path=aircraft")
    expect(calls).toEqual(["https://gw.test/aircraft?reg=9V-TNL"])
  })

  it("turns away a request with neither the secret nor a session cookie", async () => {
    const res = await call(["aircraft"], { "x-lookup-secret": "wrong" })
    expect(res.status).toBe(401)
    expect(calls).toEqual([])
  })

  it("asks the session route on this origin, forwarding the cookies", async () => {
    routes["https://app.test/api/auth/session"] = () => json({ authenticated: true })
    const res = await call(["aircraft"], { cookie: "session=t; _vercel_jwt=j" })
    expect(res.status).toBe(200)
    expect(calls).toEqual(["https://app.test/api/auth/session", "https://gw.test/aircraft?reg=9V-TNL"])
  })

  it("turns away a cookie the session route does not recognise", async () => {
    routes["https://app.test/api/auth/session"] = () => json({ authenticated: false })
    expect((await call(["aircraft"], { cookie: "session=stale" })).status).toBe(401)
  })

  it("answers 503 when the session check itself fails — not a sign-out", async () => {
    routes["https://app.test/api/auth/session"] = () => json({ error: "db down" }, 500)
    expect((await call(["aircraft"], { cookie: "session=t" })).status).toBe(503)
  })

  it("passes the Worker's not-found through, and refuses routes it does not serve", async () => {
    routes["https://gw.test/"] = () => json({ ok: false, error: "No aircraft found" }, 404)
    expect((await call(["aircraft"], { "x-lookup-secret": "s3cret" })).status).toBe(404)
    expect((await call(["raw"], { "x-lookup-secret": "s3cret" }, "?url=x")).status).toBe(404)
    expect((await call(["probe"], { "x-lookup-secret": "s3cret" }, "")).status).toBe(404)
  })

  it("answers a composed route in the same envelope, behind the same rule", async () => {
    routes["https://gw.test/"] = () =>
      json({ ok: true, source: "search", data: { aircraft: [{ id: "9V-TNL", label: "9V-TNL", detail: { equip: "A320" }, type: "aircraft" }] } })
    expect((await call(["aircraft", "candidates"], {}, "?q=9V-TNL")).status).toBe(401)

    const res = await call(["aircraft", "candidates"], { "x-lookup-secret": "s3cret" }, "?q=9V-TNL")
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, source: "search", data: [{ registration: "9V-TNL", exact: true }] })
    expect(calls).toEqual(["https://gw.test/search?q=9V-TNL&limit=30"])
  })

  it("lists the composed routes beside the Worker's when it refuses one", async () => {
    const body = await (await call(["nope"], { "x-lookup-secret": "s3cret" }, "")).json()
    expect(body.routes).toEqual(expect.arrayContaining(["search", "aircraft/candidates", "airport/candidates"]))
  })
})
