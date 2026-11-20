"use client"

import useSWR from "swr"
import { lookup } from "@/lib/lookup/client"
import type { Alternate } from "@/lib/weather/alternates"
import type { WeatherAnswer } from "@/lib/weather/types"
import type { LatLon } from "@/lib/utils/geo"

/**
 * The aerodromes a duty could divert to — near each destination and along
 * each leg — with their METAR and TAF, from the weather snapshot. Asked only
 * while a card that lists them is open and the duty is within a TAF's reach;
 * never stored (the weather in it moves).
 */
const NO_ALTERNATES: Alternate[] = []

export function useAlternates(
  path: readonly (LatLon & { icao: string })[],
  dests: readonly LatLon[],
  enabled: boolean,
): { alternates: Alternate[]; weather: WeatherAnswer | null; loading: boolean; failed: boolean } {
  const key =
    enabled && path.length > 1
      ? `lookup:alternates:${path.map((p) => p.icao).join("-")}:${dests.map((d) => `${d.lat.toFixed(2)},${d.lon.toFixed(2)}`).join(";")}`
      : null
  const { data, error, isLoading } = useSWR(
    key,
    async () => {
      const res = await lookup.alternates(path, dests, path.map((p) => p.icao))
      if (!res.ok) throw new Error(res.error)
      return res.data
    },
    { revalidateOnFocus: false, shouldRetryOnError: false, dedupingInterval: 10 * 60_000 },
  )
  return { alternates: data?.alternates ?? NO_ALTERNATES, weather: data?.weather ?? null, loading: isLoading, failed: !!error }
}
