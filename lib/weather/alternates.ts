/**
 * The airports a duty could divert to — the owner's "what nearby airports and
 * along route do we have", and their weather.
 *
 * Candidates are the aerodromes that issue a TAF (the weather snapshot's TAF
 * stations, with the position the cache file gives each): an aerodrome with a
 * forecast is one a planner can name as an alternate, where a METAR alone is
 * often an automatic station on a field nobody lands on.
 *
 * | | which | how many |
 * |---|---|---|
 * | near a destination | within `nearNm`, nearest first | `near` per destination |
 * | along a leg | within `corridorNm` of its great circle, between a seventh and six sevenths of the way, the one nearest the track in each part of the leg | `perLeg` per leg |
 *
 * An airport the duty itself flies to is never its own alternate, and one
 * already listed is not listed twice (a turnaround's legs are the same
 * corridor both ways).
 */

import { greatCircleNm, offTrack, type LatLon } from "@/lib/utils/geo"

/** [ICAO, latitude, longitude] — the snapshot's index of TAF aerodromes. */
export type GeoEntry = [string, number, number]

export interface Alternate {
  icao: string
  lat: number
  lon: number
  kind: "near" | "route"
  /** Near: from its destination. Route: off the track. */
  distNm: number
  /** Near: which destination (index into `dests`). Route: which leg (index into the path's legs). */
  of: number
  /** Route: how far along its leg, nm. */
  alongNm?: number
}

export interface AlternateOptions {
  nearNm?: number
  near?: number
  corridorNm?: number
  perLeg?: number
}

export function pickAlternates(
  index: readonly GeoEntry[],
  path: readonly LatLon[],
  dests: readonly LatLon[],
  exclude: ReadonlySet<string>,
  { nearNm = 150, near = 3, corridorNm = 150, perLeg = 3 }: AlternateOptions = {},
): Alternate[] {
  const out: Alternate[] = []
  const taken = new Set(exclude)

  dests.forEach((d, of) => {
    index
      .filter(([icao]) => !taken.has(icao))
      .map(([icao, lat, lon]) => ({ icao, lat, lon, distNm: greatCircleNm(d, { lat, lon }) }))
      .filter((s) => s.distNm <= nearNm)
      .sort((a, b) => a.distNm - b.distNm)
      .slice(0, near)
      .forEach((s) => {
        taken.add(s.icao)
        out.push({ ...s, kind: "near", of, distNm: Math.round(s.distNm) })
      })
  })

  for (let leg = 0; leg + 1 < path.length; leg++) {
    const a = path[leg]
    const b = path[leg + 1]
    const len = greatCircleNm(a, b)
    // A short hop has no "along the way" a near list did not already cover.
    if (len < 2 * nearNm) continue
    const buckets: (Alternate | null)[] = Array.from({ length: perLeg }, () => null)
    for (const [icao, lat, lon] of index) {
      if (taken.has(icao)) continue
      const p = { lat, lon }
      // Cheap reject first: nothing further from both ends than the leg is long.
      if (greatCircleNm(a, p) > len + corridorNm) continue
      const { crossNm, alongNm } = offTrack(p, a, b)
      if (crossNm > corridorNm) continue
      const f = alongNm / len
      if (f < 1 / 7 || f > 6 / 7) continue
      const i = Math.min(perLeg - 1, Math.floor(((f - 1 / 7) / (5 / 7)) * perLeg))
      const best = buckets[i]
      if (!best || crossNm < best.distNm) {
        buckets[i] = { icao, lat, lon, kind: "route", distNm: crossNm, of: leg, alongNm }
      }
    }
    for (const s of buckets) {
      if (!s || taken.has(s.icao)) continue
      taken.add(s.icao)
      out.push({ ...s, distNm: Math.round(s.distNm), alongNm: Math.round(s.alongNm ?? 0) })
    }
  }
  return out
}

/**
 * The times each alternate matters, for reading its TAF: a destination's
 * nearby aerodromes over the duty's arrivals there (± an hour), an en-route
 * one over its leg from off blocks to on (± an hour).
 */
export function alternateWindows(
  alts: readonly Alternate[],
  legs: readonly { label: string; arrivalIcao: string; departMs: number | null; arriveMs: number | null }[],
  destIcaos: readonly string[],
  windowMs = 3600_000,
): { station: string; role: "arr"; label: string; atMs: number; fromMs: number; toMs: number }[] {
  const out: { station: string; role: "arr"; label: string; atMs: number; fromMs: number; toMs: number }[] = []
  for (const a of alts) {
    if (a.kind === "near") {
      const dest = (destIcaos[a.of] ?? "").toUpperCase()
      for (const l of legs) {
        if (l.arriveMs === null || l.arrivalIcao.toUpperCase() !== dest) continue
        out.push({ station: a.icao, role: "arr", label: l.label, atMs: l.arriveMs, fromMs: l.arriveMs - windowMs, toMs: l.arriveMs + windowMs })
      }
    } else {
      const l = legs[a.of]
      if (!l || l.departMs === null || l.arriveMs === null) continue
      out.push({ station: a.icao, role: "arr", label: l.label, atMs: l.arriveMs, fromMs: l.departMs - windowMs, toMs: l.arriveMs + windowMs })
    }
  }
  return out
}
