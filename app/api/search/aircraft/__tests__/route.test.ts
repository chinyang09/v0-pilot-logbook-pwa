/**
 * /api/search/aircraft — Edge, ONE call to the gateway Worker's `/aircraft`
 * chain, answering `{ results }` in the shape the callers have always read.
 * The legacy search passthrough it replaced answered the same fields but made
 * up to three near-identical searches on a miss.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { GET, runtime } from "../route"

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

describe("GET /api/search/aircraft", () => {
  const calls: string[] = []
  let answer: () => Response

  beforeEach(() => {
    calls.length = 0
    vi.stubEnv("FR24_PROXY_URL", "https://gw.test/")
    vi.stubEnv("FR24_PROXY_SECRET", "s")
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => (calls.push(String(input)), answer())))
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  const get = async (q: string) => (await GET(new Request(`https://app.test/api/search/aircraft?q=${q}`))).json()

  it("runs on the Edge runtime", () => {
    expect(runtime).toBe("edge")
  })

  it("asks the Worker's /aircraft chain once and answers the callers' shape", async () => {
    answer = () =>
      json({
        ok: true,
        source: "search",
        data: [{ registration: "9V-OFH", icao24: "76BCC8", typecode: "B788", model: "", serialNumber: "", operator: "TGW", operatorIata: "", operatorIcao: "", owner: "TGW" }],
      })
    expect(await get("9V-OFH")).toEqual({
      results: [{ registration: "9V-OFH", icao24: "76BCC8", typecode: "B788", operator: "TGW", source: "fr24" }],
    })
    expect(calls).toEqual(["https://gw.test/aircraft?reg=9V-OFH"])
  })

  it("answers no results for a miss or a failure, with one call either way", async () => {
    answer = () => json({ ok: false, error: "No aircraft found for 9VO" }, 404)
    expect(await get("9VO")).toEqual({ results: [] })
    answer = () => json({ ok: false, error: "Upstream failed: Cloudflare challenge" }, 502)
    expect(await get("9V-OFH")).toEqual({ results: [] })
    expect(calls).toHaveLength(2)
  })

  it("does not ask for a query shorter than two characters", async () => {
    expect(await get("9")).toEqual({ results: [] })
    expect(calls).toEqual([])
  })
})
