"use client"

/**
 * The AIRPORT tile and its card — the airport and its weather in one (the
 * owner, Nov 2026: "combine airport and weather widget … they will synergise
 * well together"). One airport of the duty a PAGE, opening on where the duty
 * goes next and swiped between (dots at the foot), drawn as a station:
 *
 * ```
 * WIII                       Q1012
 * ✈↓ 25L      · · ◤ · ·        IFR
 * ✈↑ 25R    ·   ═══▶   ·   220° 15kt G25
 *           ·  ═══     ·
 *             · · · · ·
 * ☁ BKN011                 🌡 28°/24°
 *               ● ○
 * ```
 *
 * The RUNWAY DIAGRAM (`RunwayDiagram`) takes the middle, as large as the
 * tile allows clear of the text (`largestCircle` — the owner: "allow ring to
 * occupy as much space as possible without any text covering it or it
 * covering any text"), and the text sits in the corners: the code and the
 * runways in use top left; the QNH, the category only below VFR (dark
 * cockpit) and the wind top right; the LOW cloud bottom left (a layer at or
 * below 3,000ft — `skyOf`; the owner: a layer at 30,000ft is no concern on
 * the approach); temperature / dew point bottom right. No local time — the
 * card has it. No alert icon: a tile with cause for concern says so with its
 * edge and the reason's colour.
 *
 * The CARD is the same airport, swiped the same way (the page is shared): the
 * airport above (`AirportPanel` — place, time, distance, wind, temperature,
 * QNH, the runway in use, its runways, what is near, last there), its METAR
 * and latest TAF below (`StationWeather`); the code, time, category, QNH and
 * temperature fly from the tile into their places.
 */

import * as React from "react"
import { PlaneLanding, PlaneTakeoff, Thermometer, Wind } from "lucide-react"
import { metarConditions, metarReadings, type FlightCategory, type StationBrief } from "@/lib/weather/brief"
import { largestCircle, type Circle } from "@/lib/utils/dashboard/largest-circle"
import { cn } from "@/lib/utils"
import { Pager, useRememberedPage } from "./pager"
import { CATEGORY_TEXT, StationWeather, skyOf, weatherStatus } from "./weather"
import { RunwayDiagram, windWords } from "./runway-diagram"
import { AirportPanel } from "./airport"
import { EnRoute, useDutyAlternates, type AlternateBrief } from "./alternates"
import { fallbackRunway, useAirportRunways, type AirportRunwayState } from "./runway-state"
import { shortDay } from "./faces"
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

/** The text is kept this far from the ring. */
const RING_GAP = 4
/** Below this the ring says nothing legible and is left out. */
const RING_MIN = 40

/**
 * The largest circle the tile holds clear of the text in its corners
 * (`largestCircle`), re-read whenever the tile or any corner's text changes
 * size. Layout values (`offset*`), never rects: the card's morph scales the
 * tile, and a scaled rect is not where anything is laid out.
 */
function useRingRoom(box: React.RefObject<HTMLDivElement | null>): Circle | null {
  const [room, setRoom] = React.useState<Circle | null>(null)
  React.useEffect(() => {
    const el = box.current
    if (!el) return
    const corners = () => [...el.querySelectorAll<HTMLElement>(":scope > [data-corner]")]
    const ro = new ResizeObserver(() => {
      const w = el.offsetWidth
      const h = el.offsetHeight
      if (w === 0 || h === 0) return
      const avoid = corners()
        .filter((c) => c.offsetWidth > 0 && c.offsetHeight > 0)
        .map((c) => ({
          left: c.offsetLeft - RING_GAP,
          top: c.offsetTop - RING_GAP,
          right: c.offsetLeft + c.offsetWidth + RING_GAP,
          bottom: c.offsetTop + c.offsetHeight + RING_GAP,
        }))
      const next = largestCircle(w, h, avoid)
      setRoom((prev) =>
        prev && next && Math.abs(prev.x - next.x) < 0.5 && Math.abs(prev.y - next.y) < 0.5 && Math.abs(prev.r - next.r) < 0.5 ? prev : next,
      )
    })
    ro.observe(el)
    for (const c of corners()) ro.observe(c)
    return () => ro.disconnect()
  }, [box])
  return room
}

/**
 * One airport as the tile has it: the runway diagram as large as the tile
 * allows, the text in its four corners. `lead`: the page on show — the
 * shared morph's keys go on it only.
 */
function StationFace({ brief, b, size, lead }: { brief: FlightBrief; b: StationBrief; size?: { cols: number; rows: number }; lead: boolean }) {
  const icao = b.station
  const key = (k: string) => (lead ? `ap-${k}-${icao}` : undefined)
  const c = b.metar ? metarConditions(b.metar.raw) : null
  const r = b.metar ? metarReadings(b.metar.raw) : null
  // The sky's own hazard (TS, FG…) — the wind's is on the dial.
  const sky = skyOf(c, b.metar?.hazards.find((h) => !/KT$/.test(h)))
  // Dark cockpit: VFR is not said; a category below it is, in its colour.
  const cat = b.metar?.category && b.metar.category !== "VFR" ? b.metar.category : null
  const tall = (size?.rows ?? 1) >= 2
  const rwy = useAirportRunways(brief, icao, b.metar?.raw, lead)
  const wind = windWords(c?.windDir, c?.windKt)
  const temp = r?.tempC !== null && r?.tempC !== undefined ? `${r.tempC}°${r.dewC !== null ? `/${r.dewC}°` : ""}` : null
  const status = brief.weather.failed
    ? "Unavailable"
    : brief.weather.loading && !brief.weather.checkedAt
      ? "Checking…"
      : !b.metar
        ? "No report"
        : null
  const box = React.useRef<HTMLDivElement>(null)
  const room = useRingRoom(box)
  const ring = room && room.r * 2 >= RING_MIN ? Math.floor(room.r * 2) : null
  return (
    <div ref={box} className="relative min-h-0 flex-1 text-[12px] leading-tight tabular-nums">
      {/* Top left: the airport, and the runways in use under it. */}
      <div data-corner className="absolute left-0 top-0 flex flex-col items-start gap-1">
        <p className="text-[18px] font-bold leading-none tracking-tight text-foreground" data-morph={key("code")}>
          {brief.code(icao)}
        </p>
        {tall && <RunwaysInUse rwy={rwy} morph={key} />}
      </div>
      {/* Top right: QNH, the category below VFR, the wind. */}
      <div data-corner className="absolute right-0 top-0 flex flex-col items-end gap-1 text-right">
        {r?.qnhHpa ? (
          <p className="leading-none text-foreground" data-morph={key("qnh")}>
            Q{r.qnhHpa}
          </p>
        ) : null}
        {cat && (
          <p className={cn("font-semibold leading-none", CATEGORY_TEXT[cat])} data-morph={key("cat")}>
            {cat}
          </p>
        )}
        {wind && (
          <p className="whitespace-nowrap font-semibold leading-none text-foreground">
            <span data-morph={key("wind")}>{wind}</span>
            {c?.gustKt ? <span className="text-status-warning"> G{c.gustKt}</span> : null}
          </p>
        )}
      </div>
      {/* Bottom left: the low cloud, or why there is no report. */}
      <div data-corner className="absolute bottom-0 left-0">
        {status ? (
          <p className="text-muted-foreground">{status}</p>
        ) : sky ? (
          <p className={cn("flex items-center gap-1 whitespace-nowrap", sky.warn ? "font-semibold text-status-warning" : "text-foreground")}>
            <sky.Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {sky.text}
          </p>
        ) : null}
      </div>
      {/* Bottom right: temperature / dew point. */}
      <div data-corner className="absolute bottom-0 right-0">
        {temp && !status && (
          <p className="flex items-center gap-0.5 whitespace-nowrap text-foreground">
            <Thermometer className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span data-morph={key("temp")}>{temp}</span>
          </p>
        )}
      </div>
      {/* The runways and the wind, as large as the corners leave room for. */}
      {room && ring && (
        <div className="absolute" style={{ left: room.x - ring / 2, top: room.y - ring / 2 }}>
          <RunwayDiagram
            geometry={rwy.geometry}
            fallback={fallbackRunway(rwy)}
            landing={rwy.landing?.ident ?? null}
            departing={rwy.departing?.ident ?? null}
            favoured={rwy.favoured?.end.ident ?? null}
            windDir={c?.windDir}
            windKt={c?.windKt}
            gust={c?.gustKt}
            size={ring}
            morph={key("rwys")}
          />
        </div>
      )}
    </div>
  )
}

/** "✈↓ 20C" over "✈↑ 20R" — the runways the traffic is using; "≋ 02C" by the wind when it has said nothing. A tailwind is amber. */
function RunwaysInUse({ rwy, morph }: { rwy: AirportRunwayState; morph: (k: string) => string | undefined }) {
  const tail = (w: { headKt: number } | null | undefined) => !!w && w.headKt < 0
  const item = (Icon: typeof Wind, ident: string, k: string, warn: boolean, label: string) => (
    <p className={cn("flex items-center gap-1 leading-none", warn ? "text-status-warning" : "text-foreground")}>
      <Icon className={cn("h-3.5 w-3.5 shrink-0", !warn && "text-muted-foreground")} aria-label={label} />
      <span className="font-semibold" data-morph={morph(k)}>
        {ident}
      </span>
    </p>
  )
  if (!rwy.landing && !rwy.departing && !rwy.favoured) return null
  return (
    <>
      {rwy.landing && item(PlaneLanding, rwy.landing.ident, "land", tail(rwy.landing.wind), "Landing")}
      {rwy.departing && item(PlaneTakeoff, rwy.departing.ident, "dep", tail(rwy.departing.wind), "Departing")}
      {rwy.favoured && item(Wind, rwy.favoured.end.ident, "fav", false, "Favoured by the wind")}
    </>
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
