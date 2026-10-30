/**
 * /api/lookup-test — the operator's test door: Edge, no sign-in, off in
 * production unless switched on, the same answers as /api/lookup plus the
 * Worker's /probe, and never /raw.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { GET, runtime } from "../[...path]/route"

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

describe("GET /api/lookup-test/[...path]", () => {
  const calls: { url: string; secret: string | null }[] = []

  beforeEach(() => {
    calls.length = 0
    vi.stubEnv("FR24_PROXY_URL", "https://gw.test/")
    vi.stubEnv("FR24_PROXY_SECRET", "s3cret")
    vi.stubEnv("VERCEL_ENV", "preview")
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        calls.push({ url, secret: new Headers(init?.headers).get("x-proxy-secret") })
        if (url.startsWith("https://gw.test/probe")) return json({ ok: true, summary: ["OK   search — 200, 80ms"] })
        return json({ ok: true, source: "airport.json", data: { icao: "WSSS" } })
      })
    )
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  const call = (path: string[], query = "") =>
    GET(new Request(`https://app.test/api/lookup-test/${path.join("/")}${query}`, { headers: { "x-vercel-id": "sin1::abc" } }), {
      params: Promise.resolve({ path }),
    })

  it("runs on the Edge runtime", () => {
    expect(runtime).toBe("edge")
  })

  it("answers a lookup without a session, as /api/lookup would", async () => {
    const res = await call(["airport"], "?code=WSSS")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, source: "airport.json", data: { icao: "WSSS" } })
    expect(calls).toEqual([{ url: "https://gw.test/airport?code=WSSS", secret: "s3cret" }])
  })

  it("runs the Worker's probe from here, saying where here is", async () => {
    const body = await (await call(["probe"], "?explore=1&airline=TGW&path=probe")).json()
    expect(body).toMatchObject({ ranFrom: { runtime: "edge", region: "sin1" }, workerStatus: 200, probe: { ok: true } })
    expect(calls[0].url).toBe("https://gw.test/probe?explore=1&airline=TGW")
  })

  it("never serves /raw", async () => {
    expect((await call(["raw"], "?url=https://api.flightradar24.com/x")).status).toBe(404)
    expect(calls).toEqual([])
  })

  it("is off in production unless switched on", async () => {
    vi.stubEnv("VERCEL_ENV", "production")
    expect((await call(["probe"])).status).toBe(404)
    vi.stubEnv("LOOKUP_TEST_ROUTE", "1")
    expect((await call(["probe"])).status).toBe(200)
  })
})
