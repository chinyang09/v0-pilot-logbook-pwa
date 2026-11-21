import { describe, expect, it } from "vitest"
import { boundsAround, runwaysInUse, type TrafficPoint } from "../runway-in-use"
import { runwayEndsFrom } from "../runway-wind"

// Changi: two parallels, 02L/20R and 02C/20C, true ~22°. A single-runway field beside it.
const WSSS = { lat: 1.3644, lon: 103.9915 }
const ends = runwayEndsFrom([
  { id: "02L/20R", trueHeading: 22 },
  { id: "02C/20C", trueHeading: 22 },
])

/** A point `nm` out along `bearing` from the airport. */
function at(bearing: number, nm: number, offRightNm = 0, track = (bearing + 180) % 360) {
  const r = (d: number) => (d * Math.PI) / 180
  const n = nm * Math.cos(r(bearing)) + offRightNm * Math.cos(r(track + 90))
  const e = nm * Math.sin(r(bearing)) + offRightNm * Math.sin(r(track + 90))
  return { latitude: WSSS.lat + n / 60, longitude: WSSS.lon + e / (60 * Math.cos(r(WSSS.lat))) }
}

const arrival = (over: Partial<TrafficPoint> & { latitude: number; longitude: number }): TrafficPoint => ({
  heading: 22,
  altitude: 2500,
  verticalSpeed: -700,
  onGround: false,
  ...over,
})

describe("runwaysInUse", () => {
  it("reads 02 from aeroplanes on final from the south, the side telling the parallels apart", () => {
    // On a 022 track, 8nm south-southwest; left of the reference point → 02L, right → 02C.
    const left = arrival({ ...at(202, 8, -0.6, 22) })
    const right = arrival({ ...at(202, 10, 0.6, 22) })
    const left2 = arrival({ ...at(202, 14, -0.7, 22) })
    expect(runwaysInUse(WSSS, ends, [left, right, left2])).toEqual([
      { ident: "02L", arrivals: 2 },
      { ident: "02C", arrivals: 1 },
    ])
  })

  it("leaves out departures, aeroplanes going away, too high or on the ground", () => {
    const climbing = arrival({ ...at(22, 5, 0, 22), verticalSpeed: 2000 })
    const away = arrival({ ...at(22, 6, 0.6, 22) })
    const high = arrival({ ...at(202, 20, 0.6, 22), altitude: 15000 })
    const ground = arrival({ ...at(202, 1, 0.6, 22), onGround: true })
    const crossing = arrival({ ...at(202, 9, 0.6, 22), heading: 110 })
    expect(runwaysInUse(WSSS, ends, [climbing, away, high, ground, crossing])).toEqual([])
  })

  it("reads 20 from the north, and an aeroplane on the centreline as the centre runway", () => {
    const centre = arrival({ ...at(22, 9, 0.05, 202), heading: 202 })
    expect(runwaysInUse(WSSS, ends, [centre])).toEqual([{ ident: "20C", arrivals: 1 }])
  })

  it("does not call parallels without a centre runway too close to the line", () => {
    const pair = runwayEndsFrom([
      { id: "02L/20R", trueHeading: 22 },
      { id: "02R/20L", trueHeading: 22 },
    ])
    expect(runwaysInUse(WSSS, pair, [arrival({ ...at(202, 8, 0.05, 22) })])).toEqual([{ ident: "02L/R", arrivals: 1 }])
  })

  it("keeps to traffic bound for the airport where the feed names a destination", () => {
    const other = arrival({ ...at(202, 8, 0.6, 22), destinationIata: "XSP" })
    const ours = arrival({ ...at(202, 9, 0.6, 22), destinationIata: "SIN" })
    expect(runwaysInUse(WSSS, ends, [other, ours], "SIN")).toEqual([{ ident: "02C", arrivals: 1 }])
  })

  it("asks the feed for a box round the airport, N,S,W,E", () => {
    const [n, s, w, e] = boundsAround(WSSS).split(",").map(Number)
    expect(n).toBeGreaterThan(WSSS.lat)
    expect(s).toBeLessThan(WSSS.lat)
    expect(w).toBeLessThan(WSSS.lon)
    expect(e).toBeGreaterThan(WSSS.lon)
    expect(n - s).toBeCloseTo(50 / 60, 2)
  })
})
