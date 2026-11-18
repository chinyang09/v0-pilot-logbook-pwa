"use client"

import { useCallback, useState } from "react"
import useSWR from "swr"
import { lookup } from "@/lib/lookup/client"
import type { WeatherAnswer } from "@/lib/weather/types"

/**
 * METAR and TAF for some stations, asked only while `active` — the dashboard
 * on screen with a duty close enough for a TAF to cover it, or a panel open.
 * The server answers from its snapshot (at most ten minutes old), so asking
 * again inside five minutes is not worth a request; it asks again every ten
 * while on screen.
 *
 * `refresh` is the pilot's: it asks for FRESH weather (`fresh=1` — the server
 * pulls a snapshot over two minutes old) past every cache, and `refreshing`
 * says so until the answer lands. It used to revalidate the same key, which
 * the browser answered from its own cache: nothing moved and nothing said why
 * (the owner's report, 18 Nov 26).
 */
export function useAirportWeather(stations: readonly string[], active: boolean) {
  const key = active && stations.length > 0 ? `lookup:wx:${stations.join(",")}` : null
  const { data, error, isLoading, mutate } = useSWR<WeatherAnswer>(
    key,
    async () => {
      const result = await lookup.weather([...stations])
      if (!result.ok) throw new Error(result.error)
      return result.data
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 5 * 60_000,
      refreshInterval: 10 * 60_000,
      keepPreviousData: true,
    },
  )
  const [refreshing, setRefreshing] = useState(false)
  const [refreshFailed, setRefreshFailed] = useState(false)
  const refresh = useCallback(() => {
    if (stations.length === 0) return
    setRefreshing(true)
    setRefreshFailed(false)
    void mutate(
      async () => {
        const result = await lookup.weather([...stations], { fresh: true })
        if (!result.ok) throw new Error(result.error)
        return result.data
      },
      { revalidate: false, rollbackOnError: false, populateCache: true },
    )
      .catch(() => setRefreshFailed(true))
      .finally(() => setRefreshing(false))
  }, [mutate, stations])
  return {
    weather: data ?? null,
    /** Nothing to show: the first ask failed. */
    failed: !!error && !data,
    /** The pilot's Refresh failed; what is shown is the answer before it. */
    refreshFailed,
    loading: isLoading,
    refreshing,
    refresh,
  }
}
