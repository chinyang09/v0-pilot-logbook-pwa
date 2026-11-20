import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { getAirportInfo, readAirportInfo, variationOf, type AirportInfo, type AirportInfoStore } from "../airport-info"

const sample = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "airports.sample.json"), "utf8")) as unknown[]
const byIcao = (id: string) => readAirportInfo(sample.find((r) => (r as { icaoId: string }).icaoId === id))!

describe("readAirportInfo — the real answer", () => {
  it("keeps each runway's TRUE heading, size and surface, longest first", () => {
    const sin = byIcao("WSSS")
    expect(sin.runways.map((r) => r.id)).toEqual(expect.arrayContaining(["02L/20R", "02C/20C"]))
    expect(sin.runways[0]).toMatchObject({ trueHeading: 23, lengthFt: 13123, widthFt: 197, surface: "Hard" })
    // Seattle: 16/34 is 164 magnetic, 180 true with 16°E — the source gives true.
    const sea = byIcao("KSEA")
    expect(sea.variationDeg).toBe(16)
    expect(sea.runways.every((r) => r.trueHeading === 180)).toBe(true)
  })

  it("reads the frequencies by name", () => {
    expect(byIcao("WSSS").freqs).toEqual([
      ["ATIS", "128.6"],
      ["TWR", "118.6"],
    ])
  })

  it("reads variation east and west, and refuses what is not a record", () => {
    expect(variationOf("1E")).toBe(1)
    expect(variationOf("5W")).toBe(-5)
    expect(variationOf("0")).toBe(0)
    expect(readAirportInfo({ icaoId: "X" })).toBeNull()
  })
})

describe("getAirportInfo — kept, and asked in one request", () => {
  const store = () => {
    const rows = new Map<string, { at: number; info: AirportInfo | null }>()
    const s: AirportInfoStore = {
      read: async (ids) => new Map(ids.filter((i) => rows.has(i)).map((i) => [i, rows.get(i)!])),
      write: async (entries) => entries.forEach((e) => rows.set(e.icao, { at: e.at, info: e.info })),
    }
    return { s, rows }
  }

  it("asks the source once for what it lacks, then answers from the store", async () => {
    const { s } = store()
    const calls: string[] = []
    const fetchImpl = (async (url: string) => {
      calls.push(url)
      return new Response(JSON.stringify(sample))
    }) as unknown as typeof fetch
    const first = await getAirportInfo(["WSSS", "VTBS", "ZZZZ"], { store: s, fetchImpl, now: 1000 })
    expect(first.WSSS?.runways.length).toBe(3)
    expect(first.ZZZZ).toBeNull()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain("ids=WSSS,VTBS,ZZZZ")
    await getAirportInfo(["WSSS", "ZZZZ"], { store: s, fetchImpl, now: 2000 })
    expect(calls).toHaveLength(1)
  })

  it("keeps what it knows when the source fails", async () => {
    const { s, rows } = store()
    rows.set("WSSS", { at: 0, info: byIcao("WSSS") })
    const fetchImpl = (async () => new Response("down", { status: 503 })) as unknown as typeof fetch
    const out = await getAirportInfo(["WSSS"], { store: s, fetchImpl, now: 40 * 86_400_000 })
    expect(out.WSSS?.icao).toBe("WSSS")
  })
})
