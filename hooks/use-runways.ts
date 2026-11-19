"use client"

import useSWR from "swr"
import { lookup } from "@/lib/lookup/client"
import { runwayNamesFrom } from "@/lib/weather/runway-wind"

/**
 * An airport's runway names ("02L/20R"), for the airport panel's wind picture.
 *
 * Asked ONLY while a card that draws them is open (`enabled`) — a runway list
 * costs a lookup and changes on the scale of years — and kept on the device
 * for 30 days, so the second look is free and works offline. A failed lookup
 * is never kept: the panel draws the wind without a runway instead.
 */
const KEPT_MS = 30 * 24 * 3600_000
const keyOf = (icao: string) => `ooo:runways:${icao}`

function kept(icao: string): string[] | null {
  try {
    const raw = window.localStorage.getItem(keyOf(icao))
    if (!raw) return null
    const { at, names } = JSON.parse(raw) as { at: number; names: string[] }
    return Date.now() - at < KEPT_MS && Array.isArray(names) ? names : null
  } catch {
    return null
  }
}

async function fetchRunways(icao: string): Promise<string[]> {
  const cached = kept(icao)
  if (cached) return cached
  const res = await lookup.airportDetails(icao)
  if (!res.ok) throw new Error(res.error)
  const names = runwayNamesFrom(res.data.runways)
  try {
    window.localStorage.setItem(keyOf(icao), JSON.stringify({ at: Date.now(), names }))
  } catch {
    // Kept for this session only.
  }
  return names
}

export function useRunways(icao: string, enabled: boolean): { names: string[]; loading: boolean } {
  const { data, isLoading } = useSWR(enabled && icao ? `lookup:runways:${icao}` : null, () => fetchRunways(icao), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    dedupingInterval: 3600_000,
  })
  return { names: data ?? [], loading: isLoading }
}
