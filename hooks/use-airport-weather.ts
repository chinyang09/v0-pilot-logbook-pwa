"use client"

import useSWR from "swr"
import { lookup } from "@/lib/lookup/client"
import type { WeatherAnswer } from "@/lib/weather/types"

/**
 * METAR and TAF for some stations, asked only while `active` (the panel is
 * open) — on demand, never in the background. The server answers from its
 * ten-minute snapshot, so asking again inside five minutes is not worth a
 * request; Refresh asks regardless.
 */
export function useAirportWeather(stations: readonly string[], active: boolean) {
  const key = active && stations.length > 0 ? `lookup:wx:${stations.join(",")}` : null
  const { data, error, isLoading, isValidating, mutate } = useSWR<WeatherAnswer>(
    key,
    async () => {
      const result = await lookup.weather([...stations])
      if (!result.ok) throw new Error(result.error)
      return result.data
    },
    { revalidateOnFocus: false, revalidateOnReconnect: false, dedupingInterval: 5 * 60_000, keepPreviousData: true },
  )
  return {
    weather: data ?? null,
    failed: !!error && !data,
    loading: isLoading || isValidating,
    refresh: () => void mutate(),
  }
}
