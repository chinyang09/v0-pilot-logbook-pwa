/**
 * /api/search/aircraft — Edge. Every aircraft the query could mean, off the
 * Worker's `/search`, each marked `exact`; the registration's flight history
 * is asked only when nothing found IS the query and the query could be a
 * whole registration.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { GET, runtime } from "../route"

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const aircraftHit = (reg: string, equip = "A320") => ({ id: reg, label: reg, detail: { owner: "Scoot", equip, hex: "76CF4C" }, type: "aircraft" })
const liveHit = (reg: string) => ({ id: "3a1b2c", label: `TR600 / ${reg}`, detail: { reg, ac_type: "A21N", operator: "TGW" }, type: "live" })

describe("GET /api/search/aircraft", () => {
  const calls: string[] = []
  let search: () => Response
  let history: () => Response

  beforeEach(() => {
    calls.length = 0
    history = () => json({ ok: false, error: "nothing" }, 404)
    vi.stubEnv("FR24_PROXY_URL", "https://gw.test/")
    vi.stubEnv("FR24_PROXY_SECRET", "s")
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        calls.push(url)
        return url.includes("/aircraft/flights") ? history() : search()
      })
    )
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  const get = async (q: string) => (await GET(new Request(`https://app.test/api/search/aircraft?q=${q}`))).json()

  it("runs on the Edge runtime", () => {
    expect(runtime).toBe("edge")
  })

  it("answers every candidate a partial registration could be, live flights included, none exact", async () => {
    search = () => json({ ok: true, source: "search", data: { aircraft: [aircraftHit("9V-OFH", "B788")], live: [liveHit("9V-OFJ"), liveHit("9V-OFH")] } })
    const { results } = await get("9VO")
    expect(results.map((r: { registration: string }) => r.registration)).toEqual(["9V-OFH", "9V-OFJ"])
    expect(results.every((r: { exact: boolean }) => !r.exact)).toBe(true)
    // An airframe hit's type wins over the live flight's.
    expect(results[0]).toMatchObject({ typecode: "B788", operator: "Scoot", icao24: "76CF4C", source: "fr24" })
    // Three characters cannot be a whole registration: no history call.
    expect(calls).toEqual(["https://gw.test/search?q=9VO&limit=30"])
  })

  it("puts the exact registration first and asks nothing more", async () => {
    search = () => json({ ok: true, source: "search", data: { aircraft: [aircraftHit("9V-OFJ"), aircraftHit("9V-OFH")] } })
    const { results } = await get("9VOFH")
    expect(results[0]).toMatchObject({ registration: "9V-OFH", exact: true })
    expect(calls).toHaveLength(1)
  })

  it("asks the flight history for a whole registration search does not list", async () => {
    search = () => json({ ok: true, source: "search", data: { aircraft: [aircraftHit("9V-TNK")] } })
    history = () =>
      json({ ok: true, source: "flight-list", data: { aircraft: { registration: "9V-TNL", icao24: "76CF4D", typecode: "A320", operator: "Scoot" }, flights: [] } })
    const { results } = await get("9V-TNL")
    expect(results.map((r: { registration: string; exact: boolean }) => [r.registration, r.exact])).toEqual([["9V-TNL", true]])
    expect(calls[1]).toBe("https://gw.test/aircraft/flights?reg=9V-TNL&limit=1")
  })

  it("answers no results when every source fails", async () => {
    search = () => json({ ok: false, error: "Upstream failed: Cloudflare challenge" }, 502)
    history = () => json({ ok: false, error: "Upstream failed" }, 502)
    expect(await get("9V-OFH")).toEqual({ results: [] })
  })

  it("does not ask for a query shorter than two characters", async () => {
    expect(await get("9")).toEqual({ results: [] })
    expect(calls).toEqual([])
  })
})
