"use client"

import useSWR from "swr"
import { lookup } from "@/lib/lookup/client"
import { addObservations, classifyTraffic, FINAL_NM, summarise, type Observation, type RunwaysInUse } from "@/lib/runways/in-use"
import { isPlaced, type RunwayGeo } from "@/lib/runways/parse"
import { asInUse, boundsAround, runwaysInUse } from "@/lib/weather/runway-in-use"
import type { RunwayEnd } from "@/lib/weather/runway-wind"

/** How often the traffic is read again while a tile or card shows it. */
const REFRESH_MS = 90_000

/**
 * What each airport's traffic has been seen doing, kept by aeroplane for the
 * window (`addObservations`) — shared by the tile and the card, and across
 * looks, so twenty minutes of arrivals stand behind the answer rather than
 * the one aeroplane on final this second. In memory only; never stored.
 */
const SEEN = new Map<string, Observation[]>()

/**
 * The runways in use at one airport — landing and departing — from the live
 * feed round it (`lookup.live`), every 90s while asked. With the airport's
 * runway THRESHOLDS (`geometry`) each aeroplane is put on a runway's own
 * centreline (`classifyTraffic`); without them, arrivals are read against
 * the airport's reference point (`runwaysInUse`, the fallback). A failed
 * read is `null`, and the card falls back to the wind's favoured runway.
 */
export function useRunwayInUse(
  airport: { latitude: number; longitude: number; iata?: string } | null | undefined,
  geometry: readonly RunwayGeo[] | null | undefined,
  fallbackEnds: readonly RunwayEnd[],
  enabled = true,
): RunwaysInUse | null | undefined {
  const at = enabled && airport && Number.isFinite(airport.latitude) && (airport.latitude !== 0 || airport.longitude !== 0) ? airport : null
  const placed = isPlaced(geometry ? { icao: "", runways: [...geometry] } : null)
  const usable = placed || fallbackEnds.length > 0
  const where = at ? `${at.latitude.toFixed(3)},${at.longitude.toFixed(3)}` : ""
  const key = at && usable ? `lookup:rwy-in-use:${where}:${placed ? "thr" : "ref"}` : null
  const { data } = useSWR(
    key,
    async () => {
      const p = { lat: at!.latitude, lon: at!.longitude }
      const res = await lookup.live({ bounds: boundsAround(p, FINAL_NM + 4), limit: 250 })
      const now = Date.now()
      if (!res.ok && res.status !== 404) return null
      const traffic = res.ok ? res.data : []
      if (!placed) return asInUse(runwaysInUse(p, fallbackEnds, traffic, at!.iata), now)
      const kept = addObservations(SEEN.get(where) ?? [], classifyTraffic(geometry!, traffic, at!.iata), now)
      SEEN.set(where, kept)
      return summarise(kept, now)
    },
    { refreshInterval: REFRESH_MS, revalidateOnFocus: false, dedupingInterval: 45_000 },
  )
  return data
}
