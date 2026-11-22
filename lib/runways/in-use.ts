/**
 * Which runways are IN USE — landing and departing — read off the traffic
 * against each runway's real THRESHOLDS (the owner, Nov 2026: "the
 * coordinates are for calculation of runway in use together with the FR24
 * API … so we can accurately determine runway in use for takeoff and
 * landing"; "not just telling what runway they have but which is in use").
 *
 * Each runway end is a line: its threshold, its true heading, its length.
 * Every aeroplane in the live feed round the airport is put into that end's
 * frame — how far ALONG the centreline (negative: before the threshold, on
 * the approach side) and how far ACROSS it (right positive):
 *
 * | | where | how |
 * |---|---|---|
 * | landing | before the threshold, out to `FINAL_NM`, inside a cone that widens 1:16 from 0.25nm | on the runway's track (±15°), not climbing, no higher than a steep approach allows (400ft + 450ft/nm) |
 * | departing | from the threshold to `CLIMB_NM` past the far end, inside a cone widening 1:8 past the end | on the runway's track (±20°), climbing — or rolling, or lined up at the threshold |
 * | on the runway | on the centreline (half its width and a margin) | rolling ≥ 40kt: a landing where the feed says it is bound here, a take-off where it says it left from here |
 *
 * Parallels need no guess: an aeroplane belongs to the end whose centreline
 * it is NEAREST. Each aeroplane counts once, for the end it fits best; a
 * flight bound elsewhere (the feed names its destination) is never a
 * landing here, one that left from elsewhere never a departure.
 *
 * One look at the traffic is a snapshot, so the observations are KEPT for a
 * while (`summarise`, by aeroplane, over `WINDOW_MS`) — three arrivals over
 * twenty minutes say more than the one on final this second.
 *
 * Pure, on plain numbers, so it is tested without the network.
 */

import type { RunwayGeo } from "./parse"

export interface TrafficPoint {
  /** The feed's id for the flight — what an observation is kept by. */
  id?: string
  latitude: number | null
  longitude: number | null
  /** True track, degrees. */
  heading: number | null
  /** Feet. */
  altitude: number | null
  /** Knots. */
  groundSpeed?: number | null
  /** Feet per minute; negative is descending. */
  verticalSpeed: number | null
  onGround: boolean
  /** IATA, when the feed says. */
  originIata?: string
  destinationIata?: string
}

export type Movement = "arrival" | "departure"

export interface Observation {
  id: string
  kind: Movement
  ident: string
  at: number
}

export interface RunwayActivity {
  ident: string
  /** Aeroplanes seen using it inside the window. */
  count: number
  /** When it was last seen used. */
  lastMs: number
}

export interface RunwaysInUse {
  arrivals: RunwayActivity[]
  departures: RunwayActivity[]
}

export const FINAL_NM = 14
export const CLIMB_NM = 8
/** How long an aeroplane seen using a runway counts toward it. */
export const WINDOW_MS = 20 * 60_000

const NM_FT = 6076.12
const diff = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180)

interface EndFrame {
  ident: string
  lat: number
  lon: number
  cosLat: number
  /** Unit vector of the heading, (east, north). */
  ux: number
  uy: number
  headingDeg: number
  lengthNm: number
  halfWidthNm: number
  elevFt: number
}

/** Every placed runway end, as a frame to read the traffic in. */
export function endFrames(runways: readonly RunwayGeo[]): EndFrame[] {
  const out: EndFrame[] = []
  for (const r of runways) {
    const [a, b] = r.ends
    for (const [e, other] of [
      [a, b],
      [b, a],
    ] as const) {
      if (!e || e.lat === null || e.lon === null) continue
      const rad = (e.headingDeg * Math.PI) / 180
      const cosLat = Math.cos((e.lat * Math.PI) / 180)
      const lengthNm =
        other && other.lat !== null && other.lon !== null
          ? Math.hypot((other.lat - e.lat) * 60, (other.lon - e.lon) * 60 * cosLat)
          : (r.lengthFt ?? 8000) / NM_FT
      out.push({
        ident: e.ident,
        lat: e.lat,
        lon: e.lon,
        cosLat,
        ux: Math.sin(rad),
        uy: Math.cos(rad),
        headingDeg: e.headingDeg,
        lengthNm,
        halfWidthNm: ((r.widthFt ?? 150) / 2 + 80) / NM_FT,
        elevFt: e.elevFt ?? other?.elevFt ?? 0,
      })
    }
  }
  return out
}

/** A point in an end's frame: nm along its centreline (from the threshold) and across it (right positive). */
export function inFrame(f: EndFrame, lat: number, lon: number): { along: number; across: number } {
  const dx = (lon - f.lon) * 60 * f.cosLat
  const dy = (lat - f.lat) * 60
  return { along: dx * f.ux + dy * f.uy, across: dx * f.uy - dy * f.ux }
}

const same = (a: string | undefined, b: string | undefined) => !!a && !!b && a.toUpperCase() === b.toUpperCase()

/**
 * What one look at the traffic shows: each aeroplane landing or departing,
 * and on which end. `iata` is this airport's, to tell bound-here from
 * bound-elsewhere where the feed names them.
 */
export function classifyTraffic(
  runways: readonly RunwayGeo[],
  traffic: readonly TrafficPoint[],
  iata?: string,
): { id: string; kind: Movement; ident: string }[] {
  const frames = endFrames(runways)
  if (frames.length === 0) return []
  const out: { id: string; kind: Movement; ident: string }[] = []
  traffic.forEach((t, i) => {
    if (t.latitude === null || t.longitude === null || t.heading === null) return
    const boundElsewhere = !!iata && !!t.destinationIata && !same(t.destinationIata, iata)
    const fromElsewhere = !!iata && !!t.originIata && !same(t.originIata, iata)
    const vs = t.verticalSpeed ?? 0
    const gs = t.groundSpeed ?? null
    let best: { kind: Movement; ident: string; score: number } | null = null
    for (const f of frames) {
      const off = diff(t.heading, f.headingDeg)
      if (off > 20) continue
      const { along, across } = inFrame(f, t.latitude, t.longitude)
      const cross = Math.abs(across)
      const h = (t.altitude ?? 0) - f.elevFt
      let kind: Movement | null = null
      if (t.onGround) {
        // On the runway itself: rolling, or lined up at the threshold.
        if (cross > f.halfWidthNm || along < -0.1 || along > f.lengthNm + 0.1 || off > 15) continue
        if (gs !== null && gs >= 40) kind = same(t.destinationIata, iata) ? "arrival" : same(t.originIata, iata) ? "departure" : null
        else if (along < 0.5 && !same(t.destinationIata, iata)) kind = "departure"
      } else if (along < 0.3 && along > -FINAL_NM) {
        // On the approach side: on final.
        const out = Math.max(0, -along)
        if (off <= 15 && cross <= 0.25 + out / 16 && vs <= 300 && h <= 400 + 450 * out && h >= -400) kind = "arrival"
      } else if (along >= 0 && along <= f.lengthNm + CLIMB_NM) {
        // Over the runway or past its far end, flying away along it: climbing out.
        const past = Math.max(0, along - f.lengthNm)
        if (cross <= 0.2 + past / 8 && h <= 1500 + 700 * past && (vs >= 300 || (h < 1500 && (gs ?? 0) >= 100))) kind = "departure"
      }
      if (!kind) continue
      if (kind === "arrival" && boundElsewhere) continue
      if (kind === "departure" && fromElsewhere) continue
      const score = cross + off / 60
      if (!best || score < best.score) best = { kind, ident: f.ident, score }
    }
    if (best) out.push({ id: t.id || `#${i}`, kind: best.kind, ident: best.ident })
  })
  return out
}

/**
 * The observations kept so far plus one more look, trimmed to the window and
 * to the LATEST observation of each aeroplane.
 */
export function addObservations(kept: readonly Observation[], seen: readonly { id: string; kind: Movement; ident: string }[], now: number): Observation[] {
  const byId = new Map<string, Observation>()
  for (const o of kept) if (now - o.at <= WINDOW_MS) byId.set(`${o.kind}:${o.id}`, o)
  for (const s of seen) byId.set(`${s.kind}:${s.id}`, { ...s, at: now })
  return [...byId.values()]
}

/** The runways in use over the window: most aeroplanes first, then the most recent. */
export function summarise(observations: readonly Observation[], now: number): RunwaysInUse {
  const tally = (kind: Movement) => {
    const m = new Map<string, RunwayActivity>()
    for (const o of observations) {
      if (o.kind !== kind || now - o.at > WINDOW_MS) continue
      const a = m.get(o.ident) ?? { ident: o.ident, count: 0, lastMs: 0 }
      a.count++
      a.lastMs = Math.max(a.lastMs, o.at)
      m.set(o.ident, a)
    }
    return [...m.values()].sort((a, b) => b.count - a.count || b.lastMs - a.lastMs || a.ident.localeCompare(b.ident))
  }
  return { arrivals: tally("arrival"), departures: tally("departure") }
}
