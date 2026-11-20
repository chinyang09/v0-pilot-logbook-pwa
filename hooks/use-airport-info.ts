"use client"

import useSWR from "swr"
import { lookup } from "@/lib/lookup/client"
import type { AirportInfo } from "@/lib/weather/airport-info"

/**
 * Airports' runways (true headings) and frequencies, for the destination card.
 *
 * Asked ONLY while a card that draws them is open (`enabled`) — reference data
 * that changes on the scale of years — and kept on the device for 30 days
 * per airport, so the second look is free and works offline. A failed lookup
 * is never kept: the card draws the wind without a runway instead.
 */
const KEPT_MS = 30 * 24 * 3600_000
const keyOf = (icao: string) => `ooo:airport-info:${icao}`

function kept(icao: string): AirportInfo | null | undefined {
  try {
    const raw = window.localStorage.getItem(keyOf(icao))
    if (!raw) return undefined
    const { at, info } = JSON.parse(raw) as { at: number; info: AirportInfo | null }
    return Date.now() - at < KEPT_MS ? info : undefined
  } catch {
    return undefined
  }
}

async function fetchInfo(ids: string[]): Promise<Record<string, AirportInfo | null>> {
  const out: Record<string, AirportInfo | null> = {}
  const ask: string[] = []
  for (const id of ids) {
    const k = kept(id)
    if (k === undefined) ask.push(id)
    else out[id] = k
  }
  if (ask.length === 0) return out
  const res = await lookup.airportInfo(ask)
  if (!res.ok) {
    if (Object.keys(out).length) return out
    throw new Error(res.error)
  }
  for (const id of ask) {
    if (!(id in res.data)) continue
    out[id] = res.data[id]
    try {
      window.localStorage.setItem(keyOf(id), JSON.stringify({ at: Date.now(), info: res.data[id] }))
    } catch {
      // Kept for this session only.
    }
  }
  return out
}

const NONE: Record<string, AirportInfo | null> = {}

export function useAirportInfo(icaos: readonly string[], enabled: boolean): Record<string, AirportInfo | null> {
  const ids = [...new Set(icaos.map((i) => i.toUpperCase()))].sort()
  const { data } = useSWR(enabled && ids.length ? `lookup:airport-info:${ids.join(",")}` : null, () => fetchInfo(ids), {
    revalidateOnFocus: false,
    // A failed ask is asked again (a cold function or a slow source), and so
    // is an answer that left an airport out — until every one is in. Neither
    // was: a new duty's destination drew no runways until the page remounted.
    errorRetryCount: 4,
    errorRetryInterval: 5_000,
    refreshInterval: (latest) => (latest && ids.every((id) => id in latest) ? 0 : 20_000),
    // Short: a kept answer costs no request (`fetchInfo` reads the device
    // first), and an hour's dedupe swallowed the refresh above.
    dedupingInterval: 10_000,
  })
  return data ?? NONE
}
