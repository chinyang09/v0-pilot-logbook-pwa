"use client"

import useSWR from "swr"
import { lookup } from "@/lib/lookup/client"
import { boundsAround, runwaysInUse, type RunwayInUse } from "@/lib/weather/runway-in-use"
import type { RunwayEnd } from "@/lib/weather/runway-wind"

/** How often the traffic is read again while the card stays open. */
const REFRESH_MS = 2 * 60_000

/**
 * The runway the traffic is landing on at one airport (`runwaysInUse`), read
 * off the live feed around it. Asked only while the card that shows it is
 * mounted (the destination card), again every two minutes; never stored. A
 * failed read is `null` — the card then keeps the wind's favoured runway.
 */
export function useRunwayInUse(
  airport: { latitude: number; longitude: number; iata?: string } | null | undefined,
  ends: readonly RunwayEnd[],
  enabled = true,
): RunwayInUse[] | null | undefined {
  const at = enabled && airport && Number.isFinite(airport.latitude) && (airport.latitude !== 0 || airport.longitude !== 0) ? airport : null
  const key = at && ends.length ? `lookup:rwy-in-use:${at.latitude.toFixed(3)},${at.longitude.toFixed(3)}` : null
  const { data } = useSWR(
    key,
    async () => {
      const p = { lat: at!.latitude, lon: at!.longitude }
      const res = await lookup.live({ bounds: boundsAround(p), limit: 200 })
      if (!res.ok) return res.status === 404 ? [] : null
      return runwaysInUse(p, ends, res.data, at!.iata)
    },
    { refreshInterval: REFRESH_MS, revalidateOnFocus: false, dedupingInterval: 60_000 },
  )
  return data
}
