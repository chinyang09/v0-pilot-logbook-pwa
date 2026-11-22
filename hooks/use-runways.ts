"use client"

import useSWR from "swr"
import { lookup } from "@/lib/lookup/client"
import type { RunwayGeo } from "@/lib/runways/parse"

/**
 * Airports' runway GEOMETRY — thresholds, true headings, elevations
 * (`/api/lookup/runways`, OurAirports) — for the airports a duty touches.
 *
 * Kept on the device 30 days per airport, so the second look costs nothing
 * and works offline; an answer from a server whose store is not loaded yet
 * (`loaded: false`) is never kept, and is asked again.
 */
const KEPT_MS = 30 * 24 * 3600_000
const keyOf = (icao: string) => `ooo:runways:v1:${icao}`

function kept(icao: string): RunwayGeo[] | null | undefined {
  try {
    const raw = window.localStorage.getItem(keyOf(icao))
    if (!raw) return undefined
    const { at, runways } = JSON.parse(raw) as { at: number; runways: RunwayGeo[] | null }
    return Date.now() - at < KEPT_MS ? runways : undefined
  } catch {
    return undefined
  }
}

async function fetchRunways(ids: string[]): Promise<Record<string, RunwayGeo[] | null>> {
  const out: Record<string, RunwayGeo[] | null> = {}
  const ask: string[] = []
  for (const id of ids) {
    const k = kept(id)
    if (k === undefined) ask.push(id)
    else out[id] = k
  }
  if (ask.length === 0) return out
  const res = await lookup.runways(ask)
  if (!res.ok) {
    if (Object.keys(out).length) return out
    throw new Error(res.error)
  }
  for (const id of ask) {
    if (!(id in res.data.data)) continue
    out[id] = res.data.data[id]
    if (!res.data.loaded) continue
    try {
      window.localStorage.setItem(keyOf(id), JSON.stringify({ at: Date.now(), runways: res.data.data[id] }))
    } catch {
      // Kept for this session only.
    }
  }
  return out
}

const NONE: Record<string, RunwayGeo[] | null> = {}

export function useRunways(icaos: readonly string[], enabled: boolean): Record<string, RunwayGeo[] | null> {
  const ids = [...new Set(icaos.map((i) => i.toUpperCase()))].sort()
  const { data } = useSWR(enabled && ids.length ? `lookup:runways:${ids.join(",")}` : null, () => fetchRunways(ids), {
    revalidateOnFocus: false,
    errorRetryCount: 4,
    errorRetryInterval: 5_000,
    dedupingInterval: 10_000,
  })
  return data ?? NONE
}
