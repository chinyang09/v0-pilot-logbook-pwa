import { describe, expect, it } from "vitest"
import { alternateWindows, pickAlternates, type GeoEntry } from "../alternates"

const WSSS = { lat: 1.3592, lon: 103.9893 }
const VTBS = { lat: 13.6826, lon: 100.7485 }
const index: GeoEntry[] = [
  ["WSSS", 1.3592, 103.9893],
  ["VTBS", 13.6826, 100.7485],
  ["VTBD", 13.9126, 100.6067], // Don Mueang, 16nm from VTBS
  ["VTBU", 12.6799, 101.005], // U-Tapao
  ["WMKK", 2.7456, 101.7099], // Kuala Lumpur, off track near the start
  ["WMKP", 5.2971, 100.2767], // Penang
  ["VTSS", 6.9332, 100.3929], // Hat Yai
  ["VTSM", 9.5478, 100.0623], // Samui
  ["RPLL", 14.5086, 121.0198], // Manila — nowhere near
]

describe("pickAlternates", () => {
  it("lists the nearest aerodromes to the destination, never the duty's own", () => {
    const alts = pickAlternates(index, [WSSS, VTBS], [VTBS], new Set(["WSSS", "VTBS"]))
    const near = alts.filter((a) => a.kind === "near").map((a) => a.icao)
    expect(near).toEqual(["VTBD", "VTBU"])
  })

  it("lists aerodromes along the leg, one per part of it, and none twice", () => {
    const alts = pickAlternates(index, [WSSS, VTBS], [VTBS], new Set(["WSSS", "VTBS"]))
    const route = alts.filter((a) => a.kind === "route")
    expect(route.map((a) => a.icao)).toEqual(expect.arrayContaining(["VTSM"]))
    expect(route.every((a) => a.distNm <= 150)).toBe(true)
    expect(new Set(alts.map((a) => a.icao)).size).toBe(alts.length)
    expect(alts.some((a) => a.icao === "RPLL")).toBe(false)
  })

  it("does not list the way back again on a turnaround", () => {
    const one = pickAlternates(index, [WSSS, VTBS], [VTBS], new Set(["WSSS", "VTBS"]))
    const both = pickAlternates(index, [WSSS, VTBS, WSSS], [VTBS], new Set(["WSSS", "VTBS"]))
    expect(both.map((a) => a.icao).sort()).toEqual(one.map((a) => a.icao).sort())
  })
})

describe("alternateWindows", () => {
  it("reads a nearby aerodrome over the arrival, an en-route one over its leg", () => {
    const H = 3600_000
    const legs = [{ label: "TR288", arrivalIcao: "VTBS", departMs: 10 * H, arriveMs: 12 * H }]
    const w = alternateWindows(
      [
        { icao: "VTBD", lat: 0, lon: 0, kind: "near", distNm: 16, of: 0 },
        { icao: "VTSM", lat: 0, lon: 0, kind: "route", distNm: 100, of: 0, alongNm: 500 },
      ],
      legs,
      ["VTBS"],
    )
    expect(w).toEqual([
      { station: "VTBD", role: "arr", label: "TR288", atMs: 12 * H, fromMs: 11 * H, toMs: 13 * H },
      { station: "VTSM", role: "arr", label: "TR288", atMs: 12 * H, fromMs: 9 * H, toMs: 13 * H },
    ])
  })
})
