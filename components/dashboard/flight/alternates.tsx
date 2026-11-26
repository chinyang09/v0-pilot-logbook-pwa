"use client"

/**
 * The aerodromes a duty could divert to (the owner: "what nearby airports and
 * along route do we have", and their weather "for possible diversion") — the
 * TAF aerodromes near each destination and along each leg (`pickAlternates`,
 * server side), each read over the time it matters (`alternateWindows`).
 *
 * Where a leg's briefing has been imported, the alternates its OFP PLANS come
 * first (`planned`), with their live weather over the arrival — the guessed
 * ones follow, without repeating them (the owner: "we need the alternates +
 * origin + destination for latest weather").
 *
 * Asked only while a card that lists them is open. Dark cockpit: an alternate
 * whose weather is fine shows its code and distance and nothing lit; one
 * below VFR or with a hazard says so in its colour.
 */

import * as React from "react"
import { useAlternates } from "@/hooks/use-alternates"
import { useAirportWeather } from "@/hooks/use-airport-weather"
import { useBriefingsByIds } from "@/hooks/data/use-briefings"
import { flightBriefingId } from "@/lib/briefing/ids"
import { alternateWindows, type Alternate } from "@/lib/weather/alternates"
import { briefStations, hazardLine, type StationBrief } from "@/lib/weather/brief"
import { cn } from "@/lib/utils"
import { destinationsOf } from "./faces"
import type { FlightBrief } from "./model"

export interface AlternateBrief {
  alt: Alternate
  brief: StationBrief | null
  /** The OFP's own alternate for that destination, from an imported briefing. */
  planned?: boolean
}

/** The duty's alternates, briefed — near each destination (by ICAO) and along the way. */
export function useDutyAlternates(brief: FlightBrief, enabled: boolean) {
  const { legs, times } = brief.duty
  const path = React.useMemo(() => {
    const out: { icao: string; lat: number; lon: number }[] = []
    const add = (icao: string) => {
      const a = brief.airports.get(icao.toUpperCase())
      if (!a || !Number.isFinite(a.latitude) || (a.latitude === 0 && a.longitude === 0)) return
      if (out[out.length - 1]?.icao === a.icao.toUpperCase()) return
      out.push({ icao: a.icao.toUpperCase(), lat: a.latitude, lon: a.longitude })
    }
    if (legs.length) add(legs[0].departureIcao)
    for (const l of legs) add(l.arrivalIcao)
    return out
  }, [legs, brief.airports])
  const destIcaos = React.useMemo(() => destinationsOf(brief).map((d) => d.icao), [brief])
  const dests = React.useMemo(
    () => destIcaos.map((i) => path.find((p) => p.icao === i)).filter((p): p is (typeof path)[number] => !!p),
    [destIcaos, path],
  )
  const { alternates, weather, loading, failed } = useAlternates(path, dests, enabled && path.length > 1)

  // The OFPs' planned alternates, per destination.
  const ids = React.useMemo(
    () => (enabled ? legs.filter((l) => l.flightNumber).map((l) => flightBriefingId(l)) : []),
    [legs, enabled],
  )
  const briefings = useBriefingsByIds(ids)
  const planned = React.useMemo(() => {
    const out: Alternate[] = []
    for (const r of briefings) {
      const b = r.data
      if (!b) continue
      const of = dests.findIndex((d) => d.icao === b.flight.arr.toUpperCase())
      if (of < 0) continue
      for (const a of b.alternates) {
        const icao = a.icao.toUpperCase()
        if (out.some((x) => x.icao === icao && x.of === of)) continue
        const at = brief.airports.get(icao)
        out.push({ icao, lat: at?.latitude ?? 0, lon: at?.longitude ?? 0, kind: "near", of, distNm: a.distNm ?? 0 })
      }
    }
    return out
  }, [briefings, dests, brief.airports])
  const plannedIds = React.useMemo(() => [...new Set(planned.map((a) => a.icao))].sort(), [planned])
  const { weather: plannedWx } = useAirportWeather(plannedIds, enabled)

  return React.useMemo(() => {
    const windows = alternateWindows([...planned, ...alternates], times, dests.map((d) => d.icao))
    const briefs = weather ? briefStations(alternates.map((a) => a.icao), windows, weather) : []
    const plannedBriefs = plannedWx ? briefStations(plannedIds, windows, plannedWx) : []
    const plannedAll: AlternateBrief[] = planned.map((alt) => ({ alt, brief: plannedBriefs.find((b) => b.station === alt.icao) ?? null, planned: true }))
    const all: AlternateBrief[] = alternates.map((alt) => ({ alt, brief: briefs.find((b) => b.station === alt.icao) ?? null }))
    const near = new Map<string, AlternateBrief[]>()
    for (const a of [...plannedAll, ...all]) {
      if (a.alt.kind !== "near") continue
      const icao = dests[a.alt.of]?.icao
      if (!icao) continue
      const list = near.get(icao) ?? []
      if (list.some((x) => x.alt.icao === a.alt.icao)) continue
      near.set(icao, [...list, a])
    }
    return { near, route: all.filter((a) => a.alt.kind === "route"), loading, failed, weatherAsked: !!weather || !!plannedWx }
  }, [alternates, weather, planned, plannedIds, plannedWx, times, dests, loading, failed])
}

/** One alternate on a line: code, how far, and — only when it matters — its weather. */
export function AlternateChip({ a, code, showWeather }: { a: AlternateBrief; code: (icao: string) => string; showWeather: boolean }) {
  // A hazard only, in amber — no flight category (the owner: no VFR / IFR tags).
  const hazard = showWeather && a.brief?.hazards.length ? hazardLine(a.brief.hazards.slice(0, 1)) : ""
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <span className="font-semibold text-foreground">{code(a.alt.icao)}</span>
      <span className="text-muted-foreground">{a.alt.distNm}nm</span>
      {hazard && <span className="font-semibold text-status-warning">{hazard}</span>}
    </span>
  )
}

/** The en-route aerodromes, leg by leg, for the weather card. */
export function EnRoute({ brief }: { brief: FlightBrief }) {
  const alts = useDutyAlternates(brief, brief.duty.legs.length > 0)
  if (alts.route.length === 0) return null
  const legs = brief.duty.legs
  const byLeg = new Map<number, AlternateBrief[]>()
  for (const a of alts.route) byLeg.set(a.alt.of, [...(byLeg.get(a.alt.of) ?? []), a])
  return (
    <div className="mt-2 border-t border-border/70 pt-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">En Route</p>
      {[...byLeg].map(([leg, list]) => (
        <p key={leg} className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[13px] tabular-nums">
          <span className="w-12 shrink-0 text-muted-foreground">{legs[leg]?.flightNumber || `Leg ${leg + 1}`}</span>
          {list.map((a) => (
            <AlternateChip key={a.alt.icao} a={a} code={brief.code} showWeather={brief.weather.asked} />
          ))}
        </p>
      ))}
    </div>
  )
}
