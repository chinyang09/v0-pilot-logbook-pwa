"use client"

import * as React from "react"
import { useRunwayInUse } from "@/hooks/use-runway-in-use"
import { hasCoordinates } from "@/lib/utils/flight-calculations"
import { metarConditions } from "@/lib/weather/brief"
import { runwayShown, type RunwayUse } from "@/lib/weather/runway-in-use"
import { runwayEndsFrom, runwayEndsFromGeo, type RunwayEnd, type WindOnRunway } from "@/lib/weather/runway-wind"
import type { RunwayGeo } from "@/lib/runways/parse"
import type { RunwaysInUse } from "@/lib/runways/in-use"
import type { FlightBrief } from "./model"

export interface AirportRunwayState {
  /** OurAirports' runways; undefined while asked, null when it has none. */
  geometry: RunwayGeo[] | null | undefined
  /** Every runway end on its true heading — the geometry's, else the airport data's. */
  ends: RunwayEnd[]
  inUse: RunwaysInUse | null | undefined
  landing: RunwayUse | null
  departing: RunwayUse | null
  /** The wind's runway — only when the traffic has said nothing. */
  favoured: WindOnRunway | null
}

/**
 * One airport's runways and which are in use, for the tile and the card
 * alike: the same SWR key, so both read one look at the traffic. `reading`:
 * whether this is the airport on show (only it reads the traffic).
 */
export function useAirportRunways(brief: FlightBrief, icao: string, metarRaw: string | null | undefined, reading: boolean): AirportRunwayState {
  const geometry = brief.runways[icao]
  const info = brief.airportInfo[icao]
  const ends = React.useMemo(
    () => (geometry?.length ? runwayEndsFromGeo(geometry) : runwayEndsFrom(info?.runways ?? [])),
    [geometry, info],
  )
  const fallback = React.useMemo(() => runwayEndsFrom(info?.runways ?? []), [info])
  const a = brief.airports.get(icao)
  const inUse = useRunwayInUse(a && hasCoordinates(a) ? a : null, geometry, fallback, reading && brief.traffic)
  const c = metarRaw ? metarConditions(metarRaw) : null
  const shown = runwayShown(ends, c?.windDir ?? null, c?.windKt, inUse)
  return { geometry, ends, inUse, ...shown }
}

/** The runway a diagram without thresholds draws: the one in use, else the wind's. */
export function fallbackRunway(rwy: AirportRunwayState): { ident: string; headingDeg: number } | null {
  const ident = rwy.landing?.ident ?? rwy.departing?.ident ?? rwy.favoured?.end.ident
  if (!ident) return null
  const end = rwy.ends.find((e) => e.ident === ident) ?? rwy.ends.find((e) => e.ident.slice(0, 2) === ident.slice(0, 2))
  return end ? { ident, headingDeg: end.headingDeg } : null
}
