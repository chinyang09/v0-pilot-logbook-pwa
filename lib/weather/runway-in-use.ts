/**
 * The runway in USE, from the traffic landing on it (the owner, Nov 2026:
 * "get the arrival traffic, determine based on trajectory which runway is in
 * use"). The live feed gives each aeroplane near the airport its position,
 * track, height and climb; one on FINAL is low, close, descending, flying
 * TOWARDS the airport, and on a track within a few degrees of a runway end's
 * heading — so it is landing on that end. Parallels are told apart by which
 * side of the airport's reference point the aeroplane is on, seen down the
 * approach; too close to call reads "20L/R".
 *
 * It is a reading of what the traffic is doing NOW, not the ATIS: say how
 * many arrivals it rests on, and nothing at all when none qualify.
 *
 * Pure, on plain numbers, so it is tested without the network.
 */

import { favouredRunway, windOn, type RunwayEnd, type WindOnRunway } from "./runway-wind"
import type { LatLon } from "@/lib/utils/geo"
import { greatCircleNm, initialCourse } from "@/lib/utils/geo"

export interface TrafficPoint {
  latitude: number | null
  longitude: number | null
  /** True track, degrees. */
  heading: number | null
  /** Feet. */
  altitude: number | null
  /** Feet per minute; negative is descending. */
  verticalSpeed: number | null
  onGround: boolean
  /** Where it is going, when the feed says (IATA). */
  destinationIata?: string
}

export interface RunwayInUse {
  /** "20R", or "20L/R" when the traffic is too close to the reference point to tell. */
  ident: string
  /** How many arrivals it rests on. */
  arrivals: number
}

/** On final: within this far, below this height. */
export const FINAL_NM = 25
export const FINAL_FT = 6000
/** The track within this of a runway end's heading. */
const TRACK_TOL_DEG = 20
/** Heading at the airport: the bearing to it within this of the track. */
const TOWARDS_TOL_DEG = 35
/** A climb faster than this is a departure or a go-around, not an arrival. */
const CLIMB_FPM = 300
/** Closer than this to the extended centreline through the reference point, a parallel is not called. */
const SIDE_NM = 0.25

const diff = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180)

/** Nautical miles off the centreline: positive is to the RIGHT of a pilot flying `headingDeg`. */
function sideNm(airport: LatLon, p: LatLon, headingDeg: number): number {
  const d = greatCircleNm(airport, p)
  if (d === 0) return 0
  const brg = initialCourse(airport, p)
  // The signed angle from the heading to the bearing of the point.
  const a = ((((brg - headingDeg) % 360) + 540) % 360 - 180) * (Math.PI / 180)
  return d * Math.sin(a)
}

/** The base designator and its side: "20R" → ["20", "R"]. */
const split = (ident: string): [string, string] => [ident.replace(/[LCR]$/, ""), ident.slice(-1).replace(/\d/, "")]

/**
 * Every runway end the traffic is landing on, most arrivals first. `iata`
 * narrows to aeroplanes bound for the airport where the feed names one.
 */
export function runwaysInUse(
  airport: LatLon,
  ends: readonly RunwayEnd[],
  traffic: readonly TrafficPoint[],
  iata?: string,
): RunwayInUse[] {
  if (ends.length === 0) return []
  const counts = new Map<string, number>()
  for (const t of traffic) {
    if (t.onGround || t.latitude === null || t.longitude === null || t.heading === null) continue
    if (t.altitude === null || t.altitude > FINAL_FT || t.altitude <= 0) continue
    if (t.verticalSpeed !== null && t.verticalSpeed > CLIMB_FPM) continue
    if (iata && t.destinationIata && t.destinationIata.toUpperCase() !== iata.toUpperCase()) continue
    const p = { lat: t.latitude, lon: t.longitude }
    const dist = greatCircleNm(p, airport)
    if (dist > FINAL_NM || dist < 0.3) continue
    if (diff(initialCourse(p, airport), t.heading) > TOWARDS_TOL_DEG) continue
    // The runway ends its track lines up with, nearest first.
    const lined = ends
      .map((e) => ({ e, off: diff(e.headingDeg, t.heading!) }))
      .filter((x) => x.off <= TRACK_TOL_DEG)
      .sort((a, b) => a.off - b.off)
    if (lined.length === 0) continue
    const [base] = split(lined[0].e.ident)
    const parallels = lined.filter((x) => split(x.e.ident)[0] === base).map((x) => x.e)
    let ident = lined[0].e.ident
    if (parallels.length > 1) {
      const side = sideNm(airport, p, lined[0].e.headingDeg)
      const sides = new Map(parallels.map((e) => [split(e.ident)[1], e.ident]))
      if (Math.abs(side) < SIDE_NM) ident = sides.get("C") ?? `${base}${[...sides.keys()].sort().join("/")}`
      else ident = sides.get(side > 0 ? "R" : "L") ?? sides.get("C") ?? `${base}${[...sides.keys()].sort().join("/")}`
    }
    counts.set(ident, (counts.get(ident) ?? 0) + 1)
  }
  return [...counts]
    .map(([ident, arrivals]) => ({ ident, arrivals }))
    .sort((a, b) => b.arrivals - a.arrivals || a.ident.localeCompare(b.ident))
}

/** The bounds the live feed is asked for around an airport: "N,S,W,E", ~FINAL_NM each way. */
export function boundsAround(p: LatLon, nm = FINAL_NM): string {
  const dLat = nm / 60
  const dLon = nm / (60 * Math.max(0.2, Math.cos((p.lat * Math.PI) / 180)))
  const f = (n: number) => n.toFixed(3)
  return [f(p.lat + dLat), f(p.lat - dLat), f(p.lon - dLon), f(p.lon + dLon)].join(",")
}

/**
 * The runway a card or tile shows: the one the traffic is LANDING on, with the
 * wind's components on it, else the one the wind favours. `landing` says which.
 */
export function runwayShown(
  ends: readonly RunwayEnd[],
  windDir: number | null | undefined,
  windKt: number | undefined,
  inUse: readonly RunwayInUse[] | null | undefined,
): { wind: WindOnRunway | null; landing: RunwayInUse | null } {
  const landing = inUse?.[0] ?? null
  const end = landing
    ? ends.find((e) => e.ident === landing.ident) ?? ends.find((e) => e.ident.slice(0, 2) === landing.ident.slice(0, 2))
    : undefined
  if (end) {
    const label = { ...end, ident: landing!.ident }
    const wind = windDir !== null && windDir !== undefined && windKt ? windOn(label, windDir, windKt) : { end: label, headKt: 0, crossKt: 0, crossFrom: null }
    return { wind, landing }
  }
  return { wind: favouredRunway(ends, windDir, windKt), landing: null }
}
