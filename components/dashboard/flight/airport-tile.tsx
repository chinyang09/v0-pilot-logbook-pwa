"use client"

/**
 * The AIRPORT tile and its card — the airport and its weather in one (the
 * owner, Nov 2026: "combine airport and weather widget … they will synergise
 * well together"). One airport of the duty a PAGE, opening on where the duty
 * goes next and swiped between (dots at the foot), drawn as a station:
 *
 * ```
 * WIII                       Q1012
 * 03:00                        IFR
 * UTC+7
 *            · · ◤ · ·
 *          ·   220°    ·
 *          ·   15kt G25·
 *            · · · · ·
 * ☁ BKN 1.1k              🌡 28°/24°
 *               ● ○
 * ```
 *
 * The code with its local time under it and the zone under that; the QNH at
 * the top right with the category under it only below VFR (dark cockpit);
 * the wind dial; the sky (cloud bases in "k") bottom left, temperature / dew
 * point bottom right. A ⚠ beside the code when another airport of the duty is
 * worse.
 *
 * The CARD is the same airport, swiped the same way (the page is shared): the
 * airport above (`AirportPanel` — place, time, distance, wind, temperature,
 * QNH, the runway in use, its runways, what is near, last there), its METAR
 * and latest TAF below (`StationWeather`); the code, time, category, QNH and
 * temperature fly from the tile into their places.
 */

import * as React from "react"
import { PlaneLanding, PlaneTakeoff, Thermometer, TriangleAlert, Wind } from "lucide-react"
import { metarConditions, metarReadings, type FlightCategory, type StationBrief } from "@/lib/weather/brief"
import { getAirportLocalTime, getAirportTimeInfo } from "@/lib/db/stores/reference/airports.store"
import { formatTimezoneOffset } from "@/lib/utils/time"
import { cn } from "@/lib/utils"
import { Pager, useRememberedPage } from "./pager"
import { CATEGORY_TEXT, StationWeather, WindDial, skyOf, weatherStatus } from "./weather"
import { AirportPanel } from "./airport"
import { EnRoute, useDutyAlternates, type AlternateBrief } from "./alternates"
import { useAirportRunways, type AirportRunwayState } from "./runway-state"
import { distanceInto, shortDay } from "./faces"
import type { FlightBrief } from "./model"

const RANK: Record<FlightCategory, number> = { VFR: 0, MVFR: 1, IFR: 2, LIFR: 3 }
const rank = (c: FlightCategory | null | undefined) => (c ? RANK[c] : -1)

/** The duty's airports in the order it meets them, as weather briefs (a brief exists for each, with or without a report). */
export function airportsOf(brief: FlightBrief): StationBrief[] {
  return brief.weather.briefs
}

/** The page tile and card share — remembered per duty and set of airports. */
function useAirportPage(brief: FlightBrief, stations: StationBrief[]) {
  const start = Math.max(0, stations.findIndex((x) => x.station === brief.weatherStation))
  return useRememberedPage(`ap:${brief.duty.atMs}:${stations.map((b) => b.station).join()}`, start, stations.length)
}

/** Whether an airport's weather needs a look: IFR / LIFR, or a hazard over the duty. */
export function stationPoor(b: StationBrief): boolean {
  return rank(b.worst) >= 2 || b.hazards.length > 0
}

/** The local time there now, and its zone. */
function localAt(brief: FlightBrief, icao: string): { time: string | null; zone: string | null } {
  const a = brief.airports.get(icao)
  if (!a?.tz) return { time: null, zone: null }
  return { time: getAirportLocalTime(a.tz).split(" ")[0], zone: formatTimezoneOffset(getAirportTimeInfo(a.tz).offset) }
}

/* ── The tile ────────────────────────────────────────────────────────────── */

export function AirportFace({ brief, size }: { brief: FlightBrief; size?: { cols: number; rows: number } }) {
  const stations = airportsOf(brief)
  const [page, setPage] = useAirportPage(brief, stations)
  if (stations.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <span className="text-[17px] font-bold leading-tight tracking-tight text-foreground">Airport</span>
        <p className="py-5 text-center text-xs text-muted-foreground">No duty ahead</p>
      </div>
    )
  }
  return (
    <Pager count={stations.length} page={page} onPage={setPage} fill morph="ap">
      {(i) => <StationFace brief={brief} b={stations[i]} size={size} lead={i === page} />}
    </Pager>
  )
}

/** One airport as the tile has it. `lead`: the page on show — the shared morph's keys go on it only. */
function StationFace({ brief, b, size, lead }: { brief: FlightBrief; b: StationBrief; size?: { cols: number; rows: number }; lead: boolean }) {
  const icao = b.station
  const key = (k: string) => (lead ? `ap-${k}-${icao}` : undefined)
  const { time, zone } = localAt(brief, icao)
  const c = b.metar ? metarConditions(b.metar.raw) : null
  const r = b.metar ? metarReadings(b.metar.raw) : null
  // The sky's own hazard (TS, FG…) — the wind's is on the dial.
  const sky = skyOf(c, b.metar?.hazards.find((h) => !/KT$/.test(h)))
  // Dark cockpit: VFR is not said; a category below it is, in its colour.
  const cat = b.metar?.category && b.metar.category !== "VFR" ? b.metar.category : null
  const elsewhere = brief.weather.briefs.some((x) => x !== b && (x.hazards.length > 0 || rank(x.worst) > rank(b.worst)))
  const wide = (size?.cols ?? 1) >= 1.5
  const tall = (size?.rows ?? 1) >= 2
  const rwy = useAirportRunways(brief, icao, b.metar?.raw, lead)
  const temp = r?.tempC !== null && r?.tempC !== undefined ? `${r.tempC}°${r.dewC !== null ? `/${r.dewC}°` : ""}` : null
  const status = brief.weather.failed
    ? "Unavailable"
    : brief.weather.loading && !brief.weather.checkedAt
      ? "Checking…"
      : !b.metar
        ? "No report"
        : null
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The code, its time and zone; the QNH, and the category under it. */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5">
            <span className="text-[21px] font-bold leading-none tracking-tight text-foreground" data-morph={key("code")}>
              {brief.code(icao)}
            </span>
            {elsewhere && <TriangleAlert className="h-3 w-3 shrink-0 text-status-warning" aria-label="Another airport of the duty has weather to look at" />}
          </p>
          {time && (
            <p className="mt-1.5 text-[14px] font-semibold leading-none tabular-nums text-foreground" suppressHydrationWarning>
              <span data-morph={key("time")}>{time}</span>
            </p>
          )}
          {zone && <p className="mt-0.5 text-[10px] font-medium leading-tight text-muted-foreground">{zone}</p>}
        </div>
        <div className="shrink-0 text-right">
          {r?.qnhHpa ? (
            <p className={cn("font-semibold leading-none tabular-nums text-foreground", wide ? "text-[17px]" : "text-[14px]")} data-morph={key("qnh")}>
              Q{r.qnhHpa}
            </p>
          ) : null}
          {cat && (
            <p className={cn("mt-1 text-[12px] font-semibold leading-none", CATEGORY_TEXT[cat])} data-morph={key("cat")}>
              {cat}
            </p>
          )}
        </div>
      </div>

      {status ? (
        <p className="flex flex-1 items-center justify-center py-3 text-xs text-muted-foreground">{status}</p>
      ) : (
        <>
          {/* The wind, in the middle of the tile. */}
          <div className="flex min-h-0 flex-1 items-center justify-center py-1">
            <WindDial dir={c?.windDir} kt={c?.windKt} gust={c?.gustKt} size={tall ? (wide ? 104 : 84) : 64} morph={key("wind")} />
          </div>
          {/* The runways in use — landing, departing — else the wind's. */}
          {tall && <RunwaysLine rwy={rwy} morph={key} />}
          {/* The sky bottom left, temperature / dew point bottom right — one line where there is room. */}
          {/* Where both do not fit, the temperature takes its own line, still at the right — never a truncated sky. */}
          <div className={cn("flex text-[12px] tabular-nums", wide ? "flex-wrap items-center justify-between gap-x-2 gap-y-0.5" : "flex-col gap-0.5")}>
            {sky && (
              <span className={cn("flex min-w-0 items-center gap-1 whitespace-nowrap", sky.warn ? "font-semibold text-status-warning" : "text-foreground")}>
                <sky.Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className={cn(!wide && "truncate")}>{sky.text}</span>
              </span>
            )}
            {temp && (
              <span className={cn("flex shrink-0 items-center gap-0.5 text-foreground", wide && "ml-auto")}>
                <Thermometer className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span data-morph={key("temp")}>{temp}</span>
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/** "✈↓ 20C  ✈↑ 20R" — the runways the traffic is using; "≋ 02C ↓8" by the wind when it has said nothing. A tailwind is amber. */
function RunwaysLine({ rwy, morph }: { rwy: AirportRunwayState; morph: (k: string) => string | undefined }) {
  const tail = (w: { headKt: number } | null | undefined) => !!w && w.headKt < 0
  const item = (Icon: typeof Wind, ident: string, k: string, warn: boolean, label: string) => (
    <span className={cn("inline-flex items-center gap-1", warn ? "text-status-warning" : "text-foreground")}>
      <Icon className={cn("h-3.5 w-3.5 shrink-0", !warn && "text-muted-foreground")} aria-label={label} />
      <span className="font-semibold" data-morph={morph(k)}>
        {ident}
      </span>
    </span>
  )
  if (!rwy.landing && !rwy.departing && !rwy.favoured) return null
  return (
    <p className="mb-0.5 flex min-w-0 flex-wrap items-center gap-x-3 text-[12px] tabular-nums">
      {rwy.landing && item(PlaneLanding, rwy.landing.ident, "land", tail(rwy.landing.wind), "Landing")}
      {rwy.departing && item(PlaneTakeoff, rwy.departing.ident, "dep", tail(rwy.departing.wind), "Departing")}
      {rwy.favoured && item(Wind, rwy.favoured.end.ident, "fav", false, "Favoured by the wind")}
    </p>
  )
}

/* ── The card ────────────────────────────────────────────────────────────── */

/** One airport's page in the card: the airport above, its reports below. */
function CardPage({
  brief,
  b,
  lead,
  near,
  openFlight,
}: {
  brief: FlightBrief
  b: StationBrief
  lead: boolean
  near: AlternateBrief[]
  openFlight: (id: string) => void
}) {
  const icao = b.station
  const rwy = useAirportRunways(brief, icao, b.metar?.raw, lead)
  const d = brief.destinations.find((x) => x.icao === icao)
  const lastLine = d ? [d.last ? `Last there ${shortDay(d.last.date)}` : "First time", d.year ? `${d.year}× this year` : null].filter(Boolean).join(" · ") : ""
  return (
    <div className="pr-px">
      <AirportPanel
        icao={icao}
        code={brief.code(icao)}
        airport={brief.airports.get(icao)}
        info={brief.airportInfo[icao]}
        metar={b.metar}
        arrivalMs={brief.duty.times.find((t) => t.arrivalIcao === icao)?.arriveMs ?? null}
        distanceNm={distanceInto(brief, icao)}
        weatherAsked={brief.weather.asked}
        nearby={near}
        codeOf={brief.code}
        lastLine={lastLine}
        onLast={d?.last ? () => openFlight(d.last!.flightId) : undefined}
        rwy={rwy}
        morph={lead}
      />
      {/* No METAR and no TAF: the half above has already said so. */}
      {(b.metar || b.taf) && (
        <div className="border-t border-border/70 pt-2.5">
          <StationWeather b={b} clock={brief.clock} now={brief.now} />
        </div>
      )}
    </div>
  )
}

/**
 * The airport in focus — the page the tile was on, swiped the same way:
 * the airport above, its METAR and TAF below. The duty's en-route aerodromes
 * and when the weather was checked close the card.
 */
export function AirportBody({ brief, openFlight }: { brief: FlightBrief; openFlight: (id: string) => void }) {
  const stations = airportsOf(brief)
  const [page, setPage] = useAirportPage(brief, stations)
  const alternates = useDutyAlternates(brief, true)
  const status = weatherStatus(brief.weather, brief.clock)
  if (stations.length === 0) return <p className="py-1 text-[13px] text-muted-foreground">No duty ahead</p>
  return (
    <div>
      <Pager count={stations.length} page={page} onPage={setPage} morph="ap">
        {(i) => <CardPage brief={brief} b={stations[i]} lead={i === page} near={alternates.near.get(stations[i].station) ?? []} openFlight={openFlight} />}
      </Pager>
      <EnRoute brief={brief} />
      {status && (
        <p className="pt-2 text-[11px] text-muted-foreground" role="status" aria-live="polite" suppressHydrationWarning>
          {status}
        </p>
      )}
    </div>
  )
}
