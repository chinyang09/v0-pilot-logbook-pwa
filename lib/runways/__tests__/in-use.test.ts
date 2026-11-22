import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { parseRunwaysCsv } from "../parse"
import { addObservations, classifyTraffic, endFrames, inFrame, summarise, WINDOW_MS, type TrafficPoint } from "../in-use"

// Changi's three parallels, off OurAirports' real file.
const WSSS = parseRunwaysCsv(readFileSync(join(__dirname, "fixtures/runways-sample.csv"), "utf8")).get("WSSS")!.runways
const frames = endFrames(WSSS)
const frame = (ident: string) => frames.find((f) => f.ident === ident)!

/** An aeroplane `along` nm down end `ident`'s centreline (negative: on its approach) and `across` nm to the right of it. */
function at(ident: string, along: number, across: number, rest: Partial<TrafficPoint>): TrafficPoint {
  const f = frame(ident)
  const dx = along * f.ux + across * f.uy
  const dy = along * f.uy - across * f.ux
  return {
    id: rest.id ?? `${ident}:${along}:${across}`,
    latitude: f.lat + dy / 60,
    longitude: f.lon + dx / (60 * f.cosLat),
    heading: f.headingDeg,
    altitude: 2000,
    groundSpeed: 150,
    verticalSpeed: -700,
    onGround: false,
    ...rest,
  }
}

describe("the runway frames", () => {
  it("place a point back where it was put", () => {
    const p = at("20C", -5, 0.4, {})
    const { along, across } = inFrame(frame("20C"), p.latitude!, p.longitude!)
    expect(along).toBeCloseTo(-5, 3)
    expect(across).toBeCloseTo(0.4, 3)
  })

  it("make each end's length the distance between its thresholds", () => {
    // 13,123ft is 2.16nm.
    expect(frame("02L").lengthNm).toBeCloseTo(2.16, 1)
  })
})

describe("classifyTraffic", () => {
  it("puts an aeroplane on final on the parallel whose centreline it is on", () => {
    for (const ident of ["20L", "20C", "20R", "02L", "02C", "02R"]) {
      const seen = classifyTraffic(WSSS, [at(ident, -6, 0.05, { altitude: 1900 })], "SIN")
      expect(seen).toEqual([{ id: expect.any(String), kind: "arrival", ident }])
    }
  })

  it("does not take an aeroplane crossing the extended centreline for an arrival", () => {
    const f = frame("20C")
    // On the approach, but flying across it.
    expect(classifyTraffic(WSSS, [at("20C", -6, 0, { heading: (f.headingDeg + 90) % 360 })], "SIN")).toEqual([])
    // On the track, but far too high for a final.
    expect(classifyTraffic(WSSS, [at("20C", -6, 0, { altitude: 9000 })], "SIN")).toEqual([])
    // Climbing away towards the threshold: not landing.
    expect(classifyTraffic(WSSS, [at("20C", -6, 0, { verticalSpeed: 1500 })], "SIN")).toEqual([])
  })

  it("never counts a flight bound elsewhere as landing here", () => {
    expect(classifyTraffic(WSSS, [at("20C", -6, 0, { destinationIata: "XSP" })], "SIN")).toEqual([])
    expect(classifyTraffic(WSSS, [at("20C", -6, 0, { destinationIata: "SIN" })], "SIN")).toHaveLength(1)
  })

  it("reads a climb-out past the far end as a departure from that end", () => {
    const len = frame("20R").lengthNm
    const seen = classifyTraffic(WSSS, [at("20R", len + 2, 0.1, { altitude: 1800, verticalSpeed: 2500, originIata: "SIN" })], "SIN")
    expect(seen).toEqual([{ id: expect.any(String), kind: "departure", ident: "20R" }])
  })

  it("reads the runway itself: a take-off roll, a landing roll, an aeroplane lined up", () => {
    const roll = (kind: "o" | "d", gs: number, along: number) =>
      at("02C", along, 0, { onGround: true, altitude: 0, verticalSpeed: 0, groundSpeed: gs, ...(kind === "o" ? { originIata: "SIN" } : { destinationIata: "SIN" }) })
    expect(classifyTraffic(WSSS, [roll("o", 120, 0.8)], "SIN")[0]).toMatchObject({ kind: "departure", ident: "02C" })
    expect(classifyTraffic(WSSS, [roll("d", 90, 1.2)], "SIN")[0]).toMatchObject({ kind: "arrival", ident: "02C" })
    expect(classifyTraffic(WSSS, [roll("o", 0, 0.05)], "SIN")[0]).toMatchObject({ kind: "departure", ident: "02C" })
    // Taxiing beside the runway is nothing.
    expect(classifyTraffic(WSSS, [at("02C", 0.8, 0.3, { onGround: true, groundSpeed: 20, altitude: 0 })], "SIN")).toEqual([])
  })

  it("reads both directions of a mixed-mode airport at once", () => {
    const len = frame("02L").lengthNm
    const seen = classifyTraffic(
      WSSS,
      [
        at("02C", -4, 0, { id: "a", altitude: 1300 }),
        at("02C", -9, 0.2, { id: "b", altitude: 2900 }),
        at("02L", len + 3, 0, { id: "c", altitude: 2500, verticalSpeed: 2200 }),
      ],
      "SIN",
    )
    expect(summarise(addObservations([], seen, 0), 0)).toEqual({
      arrivals: [{ ident: "02C", count: 2, lastMs: 0 }],
      departures: [{ ident: "02L", count: 1, lastMs: 0 }],
    })
  })
})

describe("keeping observations", () => {
  it("keeps each aeroplane once, its latest look, inside the window", () => {
    let kept = addObservations([], [{ id: "a", kind: "arrival", ident: "20C" }], 0)
    kept = addObservations(kept, [{ id: "a", kind: "arrival", ident: "20C" }, { id: "b", kind: "arrival", ident: "20R" }], 60_000)
    expect(summarise(kept, 60_000).arrivals.map((a) => [a.ident, a.count])).toEqual([
      ["20C", 1],
      ["20R", 1],
    ])
    // Twenty minutes later neither counts any more.
    expect(summarise(kept, 60_000 + WINDOW_MS + 1).arrivals).toEqual([])
    expect(addObservations(kept, [], 60_000 + WINDOW_MS + 1)).toEqual([])
  })
})
