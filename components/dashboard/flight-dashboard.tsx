"use client"

/**
 * The FLIGHT dashboard — the dashboard's first page, read in the order a
 * pilot's day runs: am I fine (status), where am I in duty and rest (the duty
 * clock), what is this or the next duty (its flights, gates and aeroplane),
 * and what it will be like (weather, crew, when I was last there), then the
 * standing questions (currency, limits).
 *
 * | | A phone | A tablet / desktop |
 * |---|---|---|
 * | layout | ONE SCREEN, NO SCROLL — tiles laid out to the height, six columns | the WHOLE width (the page holds `useMainPanelFullWidth`), twelve columns from 760px, each face given its real width (`faceSizeOn`) so a wide tile lays out more |
 * | a tap on a tile | the tile GROWS into a card over the page (`WidgetSheet`) | the same |
 *
 * The detail panel comes back only for a flight opened from a card.
 *
 * Every figure comes from ONE model (`FlightBrief`) built once a minute, so a
 * tile, its sheet and the panel cannot disagree. Gates, the inbound aeroplane
 * and the weather are asked by themselves, only while the page is on screen
 * and the duty close enough for them to be published (18h for gates, 30h —
 * a TAF's reach — for weather), and never stored.
 */

import * as React from "react"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import { useAircraftRecords } from "@/hooks/data/use-aircraft-records"
import { useFlights } from "@/hooks/data/use-flights"
import { usePersonnel } from "@/hooks/data/use-crew"
import { useCurrencies } from "@/hooks/data/use-currencies"
import { currencySummary } from "@/lib/utils/dashboard/currency-summary"
import { useFDPData } from "@/hooks/data/use-fdp-data"
import { usePilotStatus } from "@/hooks/data/use-pilot-status"
import { usePageActive } from "@/hooks/use-page-active"
import { useDayKey } from "@/hooks/use-day-key"
import { flushSync } from "react-dom"
import { useDutyLookups } from "@/hooks/use-duty-lookups"
import { useAirportWeather } from "@/hooks/use-airport-weather"
import { useRunways } from "@/hooks/use-runways"
import { useAirportInfo } from "@/hooks/use-airport-info"
import { usePreferences } from "@/components/providers/preferences-provider"
import { Skeleton } from "@/components/ui/skeleton"
import { ninetyDayRecency } from "@/lib/utils/dashboard-aggregate"
import { dutyFlights } from "@/lib/utils/dashboard/duty-flights"
import { describeDuty } from "@/lib/utils/dashboard/duty-line"
import { dutyWindow } from "@/lib/utils/dashboard/duty-status"
import { fdpMinutesOf } from "@/lib/utils/roster/fdp-calculator"
import { delayMargin } from "@/lib/utils/dashboard/delay-margin"
import { estimateDutyIn } from "@/lib/utils/dashboard/estimated-in"
import { limitDetails } from "@/lib/utils/dashboard/limit-detail"
import type { FlightTimesLive } from "@/lib/lookup/flight-suggest"
import { crewOnDuty, destinationVisits, dutyStations, legTimes } from "@/lib/utils/dashboard/flight-brief"
import { briefStations, stationWindows } from "@/lib/weather/brief"
import { getAirportDisplayCode } from "@/lib/utils/airport-display"
import { formatInstant } from "@/lib/utils/tz-format"
import { formatDayAt } from "@/lib/utils/date"
import { getAirportByIcao, getAirportsRevision, isAirportTableSeeded, onAirportSeedProgress } from "@/lib/db/stores/reference/airports.store"
import type { Airport } from "@/types/entities/airport.types"
import { cn } from "@/lib/utils"
import { useTick } from "./flight/instruments"
import { CurrencyFace, DutyFace, FlightFace, LimitsFace, currencyRows, destinationsOf, favouredAt, inboundLate, legDelay, limitsOf, marginText } from "./flight/faces"
import { TileRows } from "./flight/tile-rows"
import { dutyTone } from "./flight/duty-clock"
import { setChosenDuty, useChosenDuty, publishDutyChoices } from "@/hooks/use-dashboard-duty"
import { destinationOfRoute } from "@/lib/utils/dashboard/destination"
import { flightBriefingId } from "@/lib/briefing/ids"
import { useBriefingsByIds } from "@/hooks/data/use-briefings"
import { type WeatherState } from "./flight/weather"
import { useDutyAlternates } from "./flight/alternates"
import { AirportFace, airportsOf, stationPoor } from "./flight/airport-tile"
import { WIDGET_TITLE, dutyRows, useWidgetCtx, widgetContent } from "./flight/details"
import { BentoGrid } from "./flight/bento"
import { setArranging, useArranging, useTileOrder, useTilePositions } from "@/hooks/use-dashboard-layout"
import { arrangeTiles, columnsOf, faceSizeOn, gridKindFor, rowHeightFor, rowsOf, type GridKind, type TileSize } from "@/lib/utils/dashboard/bento"
import { Widget, WidgetSheet, type WidgetAnchor, type WidgetId } from "./flight/widget"
import type { DutyChoice, FlightBrief } from "./flight/model"
import type { DutyPeriod } from "@/types/entities/roster.types"
import type { RequirementState } from "@/lib/utils/dashboard/legality"

/** How far either side of now a duty's gates and aeroplane are worth asking about. */
const LOOKUP_WINDOW_MS = 18 * 3600_000
/** How many duties ahead the flight card can step to. */
const CHOICES = 14

/** A duty with flying in it — what the flight card can be about. */
const hasFlying = (dp: DutyPeriod) => !dp.dutyKind || dp.dutyKind === "flight" || dp.dutyKind === "positioning"

/** The worst state among some requirements — a card's tint. */
function worstOf(states: RequirementState[]): RequirementState | null {
  if (states.includes("fail")) return "fail"
  if (states.includes("caution") || states.includes("unknown")) return "caution"
  return null
}

/**
 * Each tile's edge — dark cockpit: nothing when all is well, amber for
 * attention, red for action. The reason is lit inside the tile.
 */
function tileTones(brief: FlightBrief): Partial<Record<WidgetId, RequirementState | null>> {
  // The airport tile: an airport of the duty IFR or with a hazard over the
  // duty's times there, or a destination whose favoured runway has a tailwind.
  const airportPoor =
    airportsOf(brief).some(stationPoor) || destinationsOf(brief).some((d) => (favouredAt(brief, d.icao)?.headKt ?? 0) < 0)
  // The flights tile: a leg still to fly that the sources now expect late,
  // or whose inbound aeroplane lands too late to turn round in time.
  const flightLate = brief.duty.legs.some((_, i) => legDelay(brief, i) !== null || inboundLate(brief, i))
  // One tile for the flights and the duty: the worse of the two.
  return {
    flight: worstOf([dutyTone(brief), flightLate ? "caution" : null].filter((t): t is RequirementState => t !== null)),
    airport: airportPoor ? "caution" : null,
    currency: worstOf(currencyRows(brief).map((r) => r.state)),
    limits: worstOf(limitsOf(brief).map((r) => r.state)),
  }
}

const NO_AIRPORTS = new Map<string, Airport>()

/** The airports by ICAO, read from the reference table (and again after any write to it). */
function useAirportsByIcao(icaos: readonly string[]): Map<string, Airport> {
  const key = icaos.join(",")
  const revision = getAirportsRevision()
  const [found, setFound] = React.useState<{ key: string; map: Map<string, Airport> } | null>(null)
  React.useEffect(() => {
    if (!key) return
    let alive = true
    const read = () =>
      void Promise.all(key.split(",").map((c) => getAirportByIcao(c).catch(() => undefined))).then((airports) => {
        if (!alive) return
        const map = new Map<string, Airport>()
        for (const a of airports) if (a) map.set(a.icao.toUpperCase(), a)
        setFound({ key, map })
      })
    read()
    // A new install is still writing the airport table: read again when it
    // has (the revision moves, but nothing re-renders this page for it).
    const off = isAirportTableSeeded() ? () => {} : onAirportSeedProgress((done) => {
      if (done >= 1) read()
    })
    return () => {
      alive = false
      off()
    }
  }, [key, revision])
  return found?.key === key ? found.map : NO_AIRPORTS
}

/** A card's header: the face at the card's full width (in face units — thirds of the row). */
const CARD_SIZE: TileSize = { cols: 3, rows: 1 }

/**
 * What a tile shows — the face its card keeps as a header. `size` is where the
 * tile sits on the grid (a face lays itself out for it: the currency's dots
 * look 90 days, six months or a year ahead); `inCard`, the card's header.
 */
function faceOf(id: WidgetId, brief: FlightBrief, size: TileSize, inCard = false, fill = false): React.ReactNode {
  // On the WIDE grid the rows share the page's height, and a tile says more
  // under its face — as many rows as its height holds, the next facts its
  // card holds (`TileRows`).
  const wide = !inCard && fill
  switch (id) {
    case "flight":
      // A standby, or no duty with flights, is the duty clock's own face; on
      // the wide grid it says the rest of its card's table under it.
      if (brief.duty.atMs === null || brief.duty.standby)
        return (
          <>
            <DutyFace brief={brief} inCard={inCard} />
            {wide && (
              <TileRows
                stacked
                rows={dutyRows(brief)
                  .filter((r) => r.slot === undefined)
                  .map((r) => ({ key: r.label, label: r.label, value: r.value, sub: r.sub, tone: r.tone }))}
              />
            )}
          </>
        )
      return (
        <FlightFace
          brief={brief}
          size={size}
          inCard={inCard}
          fill={wide}
          dutyMore={
            wide ? (
              <TileRows
                stacked
                rows={dutyRows(brief)
                  .filter((r) => r.slot === undefined)
                  .map((r) => ({ key: r.label, label: r.label, value: r.value, sub: r.sub, tone: r.tone }))}
              />
            ) : undefined
          }
        />
      )
    case "airport":
      return <AirportFace brief={brief} size={size} />
    case "currency":
      return <CurrencyFace brief={brief} size={size} fill={wide} />
    case "limits":
      return (
        <>
          <LimitsFace brief={brief} size={size} fill={wide} />
          {/* How much later the duty can run inside each window (the card's). */}
          {wide && brief.margin && (
            <TileRows
              caption="If This Duty Runs Late"
              rows={brief.margin.each
                .filter((e) => e.limit !== "FDP")
                .map((e) => ({
                  key: e.limit,
                  label: e.limit,
                  value: `+${marginText(e.minutes)}`,
                  tone: e.minutes <= 0 ? "fail" : e.minutes < 60 ? "caution" : undefined,
                }))}
            />
          )}
          {/* No duty to run late (a standby): when each limit frees up instead. */}
          {wide && !brief.margin && brief.limits.some((l) => l.rollOff) && (
            <TileRows
              caption="Frees Up"
              rows={brief.limits
                .filter((l) => l.rollOff)
                .map((l) => ({
                  key: l.id,
                  label: l.label,
                  sub: formatDayAt(l.rollOff!.atMs, "UTC", { weekday: false, year: l.days > 60 }),
                  value: `+${marginText(l.rollOff!.minutes)}`,
                }))}
            />
          )}
        </>
      )
  }
}

export function FlightDashboard({ className }: { className?: string }) {
  // Which duty the page is about: null is the default (in progress, else
  // next), chosen in the header. Coming back to the page goes back to it.
  const chosenAt = useChosenDuty()
  const isActive = usePageActive("/", () => {
    setChosenDuty(null)
    setArranging(false)
  })
  const order = useTileOrder()
  // The box the tiles have decides the grid — six columns or twelve, held
  // landscape or upright (`gridKindFor`) — and its ROW height: the box's
  // height shared out among the grid's rows (`rowHeightFor`), so a tile's
  // rows are a fixed size, not its content's. Read in a ResizeObserver; the
  // first answer is rendered before the frame paints (flushSync), so a
  // desktop never shows the phone's grid.
  const [gridBox, setGridBox] = React.useState<{ grid: GridKind; px: number; rowPx: number }>({ grid: "narrow", px: 0, rowPx: 0 })
  const roRef = React.useRef<ResizeObserver | null>(null)
  const gridRef = React.useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect()
    roRef.current = null
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const px = Math.round(entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width)
      const h = Math.round(entry.contentBoxSize?.[0]?.blockSize ?? entry.contentRect.height)
      const grid = gridKindFor(px, h)
      const rowPx = rowHeightFor(grid, h)
      flushSync(() =>
        setGridBox((b) => (b.grid === grid && Math.abs(b.px - px) < 1 && Math.abs(b.rowPx - rowPx) < 1 ? b : { grid, px, rowPx })),
      )
    })
    ro.observe(el)
    roRef.current = ro
  }, [])
  const { grid, px: gridPx, rowPx } = gridBox
  const positions = useTilePositions(grid)
  const faceSizeOf = React.useCallback((size: TileSize) => faceSizeOn(size, grid, gridPx, rowPx), [grid, gridPx, rowPx])
  // A tile with room under its face says the next facts its card holds, as
  // many as fit (`TileRows`): every tile on the wide grid, and on a phone a
  // tile the pilot made tall enough for them — a home screen has spaces, but
  // not inside a tile.
  const fillsRoom = (size: TileSize) => grid !== "narrow" || size.rows >= 1.5
  const arranging = useArranging()
  const now = useTick(isActive)
  const { preferences } = usePreferences()
  const display = preferences?.display
  const authority = preferences?.logging?.authority ?? "CAAS"
  const { flights, isLoading: flightsLoading } = useFlights()
  const { personnel } = usePersonnel()
  const { currencies } = useCurrencies()
  const { allDutyPeriods, pastDuties } = useFDPData()
  const dayKey = useDayKey()
  const recency = React.useMemo(
    () => ninetyDayRecency(flights),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dayKey is the "now" input
    [flights, dayKey],
  )
  const { status, isLoading: statusLoading } = usePilotStatus(recency, now, display)

  /* ── The duty the page is about ──────────────────────────────────────── */
  // A flight duty in progress; else a STANDBY in progress or one that comes
  // before the next flight duty (the owner, Nov 2026: on standby the flight
  // tiles are not applicable — the page is about the standby); else the next
  // flight duty.
  const onDuty = status.duty.phase === "on_duty" && status.duty.active !== null
  const sbyNow = status.duty.standby && !status.duty.standby.activated ? status.duty.standby : null
  const searchMinute = Math.floor(now / 60_000)
  const nextReportMs = status.duty.next?.reportMs
  const nextStandby = React.useMemo(() => {
    if (onDuty || sbyNow) return null
    const now = searchMinute * 60_000
    const before = nextReportMs ?? Infinity
    let best: { atMs: number; id: string } | null = null
    for (const dp of allDutyPeriods) {
      if (dp.dutyKind !== "standby") continue
      const w = dutyWindow(dp)
      if (!w || w.startMs <= now || w.startMs >= before) continue
      if (!best || w.startMs < best.atMs) best = { atMs: w.startMs, id: dp.id }
    }
    return best
  }, [allDutyPeriods, onDuty, sbyNow, nextReportMs, searchMinute])
  const defaultAt = onDuty
    ? status.duty.active!.startMs
    : sbyNow
      ? sbyNow.startMs
      : (nextStandby?.atMs ?? status.duty.next?.reportMs ?? null)
  const defaultId = onDuty ? status.duty.active!.id : sbyNow ? sbyNow.id : (nextStandby?.id ?? status.duty.next?.id ?? null)
  const choices: DutyChoice[] = React.useMemo(() => {
    const byId = defaultId ? allDutyPeriods.find((dp) => dp.id === defaultId) ?? null : null
    const after = defaultAt ?? now
    const later = allDutyPeriods
      .filter((dp) => hasFlying(dp) || dp.dutyKind === "standby")
      .map((dp) => ({ period: dp, atMs: dutyWindow(dp)?.startMs ?? NaN }))
      .filter((c) => Number.isFinite(c.atMs) && c.atMs > after + 60_000)
      .sort((a, b) => a.atMs - b.atMs)
    const list = defaultAt !== null ? [{ atMs: defaultAt, period: byId }, ...later] : later
    return list.slice(0, CHOICES)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `now` matters only with nothing ahead; the list moves on as duties do
  }, [allDutyPeriods, defaultAt, defaultId, defaultAt === null ? now : 0])
  const found = chosenAt === null ? 0 : choices.findIndex((c) => c.atMs === chosenAt)
  const index = Math.max(0, found)
  const choice = choices[index] ?? null
  const current = onDuty && index === 0
  const dutyAtMs = choice?.atMs ?? null
  // The chosen duty is a standby: no flights, no airports — its window only.
  const standby = React.useMemo(() => {
    const dp = choice?.period
    if (!dp || dp.dutyKind !== "standby") return null
    const w = dutyWindow(dp)
    if (!w) return null
    return {
      startMs: w.startMs,
      endMs: w.endMs,
      current: index === 0 && !!sbyNow && sbyNow.id === dp.id,
      code: dp.standbyKind === "airport" ? "Airport Standby" : "Standby",
    }
  }, [choice, index, sbyNow])
  const selectDuty = React.useCallback(
    (atMs: number) => setChosenDuty(choices[0]?.atMs === atMs ? null : atMs),
    [choices],
  )
  const fdp = React.useMemo(() => {
    if (current || !choice || choice.period?.dutyKind === "standby") return null
    if (index === 0 && status.duty.next) {
      const n = status.duty.next
      return n.plannedFdpMinutes > 0 ? { planned: n.plannedFdpMinutes, max: n.maxFdpMinutes } : null
    }
    const dp = choice.period
    return dp && dp.maxFdpMinutes > 0 ? { planned: fdpMinutesOf(dp), max: dp.maxFdpMinutes } : null
  }, [current, choice, index, status.duty.next])
  // How much later this duty can run: its own FDP, and every rolling window
  // that holds it (the duties rostered after it included).
  const margin = React.useMemo(() => {
    const dp = choice?.period
    if (!dp || dp.dutyKind === "standby") return null
    return delayMargin(allDutyPeriods, dp, dp.maxFdpMinutes > 0 ? dp.maxFdpMinutes - fdpMinutesOf(dp) : null)
  }, [choice, allDutyPeriods])
  // The limits in detail, as of the minute: the chosen duty's share when it
  // is not counted yet.
  const nowMinute = Math.floor(now / 60_000)
  const limitDetail = React.useMemo(
    () => limitDetails(pastDuties, allDutyPeriods, nowMinute * 60_000, choice?.period ?? null),
    [pastDuties, allDutyPeriods, nowMinute, choice],
  )
  const legs = React.useMemo(
    () => (dutyAtMs === null || standby ? [] : dutyFlights(flights, dutyAtMs)),
    [flights, dutyAtMs, standby],
  )
  const times = React.useMemo(() => legs.map(legTimes), [legs])
  const lookupsClose = dutyAtMs !== null && !standby && Math.abs(dutyAtMs - now) <= LOOKUP_WINDOW_MS
  // Within three hours of it, or on it, a delay moves by the minute: ask more often.
  const lookupsFast = dutyAtMs !== null && (current || Math.abs(dutyAtMs - now) <= 3 * 3600_000)
  const lookups = useDutyLookups(lookupsClose ? dutyAtMs : null, { active: isActive, fast: lookupsFast })
  // The duty's estimated IN: the logbook's times, then the sources' live ones.
  const estimate = React.useMemo(() => {
    const live: Record<string, FlightTimesLive | null> = {}
    const gates = lookupsClose ? lookups.lookups?.gates : undefined
    for (const [id, g] of Object.entries(gates ?? {})) live[id] = g.status === "done" ? (g.gates.times ?? null) : null
    // The aeroplane coming in for the next leg to fly: its arrival holds that leg back.
    const w = lookupsClose && lookups.lookups?.inbound?.status === "done" ? lookups.lookups.inbound.whereabouts : null
    const arrivalMs = w?.inbound?.arrival ? Date.parse(w.inbound.arrival) : NaN
    const inbound = lookups.lookups?.inboundFlightId && Number.isFinite(arrivalMs) ? { legId: lookups.lookups.inboundFlightId, arrivalMs } : null
    return estimateDutyIn(legs, live, inbound)
  }, [legs, lookupsClose, lookups.lookups])
  const info = React.useMemo(
    () =>
      lookupsClose && lookups.legs.length > 0
        ? describeDuty(lookups.legs, lookups.lookups, lookups.loading, lookups.refresh, display)
        : null,
    [lookupsClose, lookups.legs, lookups.lookups, lookups.loading, lookups.refresh, display],
  )

  /* ── Crew and destinations ───────────────────────────────────────────── */
  const crew = React.useMemo(
    () => crewOnDuty(legs, flights, personnel ?? [], dayKey),
    [legs, flights, personnel, dayKey],
  )
  const legCrew = React.useMemo(
    () => legs.map((l) => crewOnDuty([l], flights, personnel ?? [], dayKey)),
    [legs, flights, personnel, dayKey],
  )
  const firstDepart = times[0]?.departMs ?? dutyAtMs
  const destinations = React.useMemo(
    () => (legs.length ? destinationVisits(legs, flights, firstDepart ?? Infinity) : []),
    [legs, flights, firstDepart],
  )
  // A later duty forecasts the currencies to its report; the next one is today's.
  const currencyAsOfMs = index > 0 && dutyAtMs !== null ? dutyAtMs : null
  const currency = React.useMemo(
    () => currencySummary(currencies, dutyAtMs, currencyAsOfMs),
    [currencies, dutyAtMs, currencyAsOfMs],
  )
  const stations = React.useMemo(() => dutyStations(legs), [legs])
  const airports = useAirportsByIcao(stations)
  // Runways for every airport of the duty — the airport card draws the one in
  // use; kept on the device 30 days, so this is rarely a request.
  const airportInfo = useAirportInfo(stations, isActive && stations.length > 0)
  // Their thresholds, for telling the runway in USE from the traffic.
  const runways = useRunways(stations, isActive && stations.length > 0)

  /* ── Weather ─────────────────────────────────────────────────────────── */
  // Live, whatever the duty's distance (the owner: "pull real time weather
  // instead of waiting"): the METAR is now; a TAF is read over the duty's
  // times once they are within its reach.
  const weatherClose = stations.length > 0
  const wx = useAirportWeather(stations, isActive && weatherClose)
  // The airport the weather tile shows: where the duty is going next.
  const weatherStation = React.useMemo(() => {
    const next = legs.find((l) => !l.inTime) ?? legs[legs.length - 1]
    return (next?.arrivalIcao || "").toUpperCase() || stations[0] || null
  }, [legs, stations])
  const windows = React.useMemo(() => stationWindows(times), [times])
  const stationBriefs = React.useMemo(() => briefStations(stations, windows, wx.weather), [stations, windows, wx.weather])
  const weather: WeatherState = React.useMemo(
    () => ({
      briefs: stationBriefs,
      asked: weatherClose && stations.length > 0,
      loading: wx.loading,
      refreshing: wx.refreshing,
      failed: wx.failed,
      refreshFailed: wx.refreshFailed,
      checkedAt: wx.weather?.checkedAt ?? null,
      sourceAt: wx.weather ? Math.max(wx.weather.fetchedAt.metar, wx.weather.fetchedAt.taf) || null : null,
      stale: !!wx.weather?.stale,
      refresh: wx.refresh,
    }),
    [stationBriefs, weatherClose, stations.length, wx.loading, wx.refreshing, wx.failed, wx.refreshFailed, wx.weather, wx.refresh],
  )

  // Each leg's imported briefing: its OFP names the aeroplane planned for it
  // (the same ids the alternates ask, so one read serves both).
  const planIds = React.useMemo(() => legs.filter((l) => l.flightNumber).map((l) => flightBriefingId(l)), [legs])
  const planRecords = useBriefingsByIds(planIds)
  const planned = React.useMemo(() => {
    const byId = new Map(planRecords.map((r) => [r.id, r]))
    return legs.map((l) => {
      const r = l.flightNumber ? byId.get(flightBriefingId(l)) : undefined
      return r?.registration ? { registration: r.registration, aircraftType: r.aircraftType } : null
    })
  }, [legs, planRecords])

  // Every aeroplane the duty names, as the aircraft database spells and types it.
  const fleetRegs = React.useMemo(() => {
    const out = legs.map((l) => l.aircraftReg || "")
    for (const p of planned) if (p) out.push(p.registration)
    const l = lookupsClose ? lookups.lookups : null
    if (l) {
      out.push(l.inboundRegistration)
      for (const g of Object.values(l.gates)) if (g?.status === "done") out.push(g.gates.flight.registration)
    }
    return out.filter(Boolean)
  }, [legs, planned, lookupsClose, lookups.lookups])
  const fleet = useAircraftRecords(fleetRegs)

  /* ── Formatting ──────────────────────────────────────────────────────── */
  const zone = React.useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])
  const pref = display?.airportIdentifier
  const iataOf = React.useMemo(() => {
    const m = new Map<string, string>()
    for (const l of legs) {
      if (l.departureIcao && l.departureIata) m.set(l.departureIcao.toUpperCase(), l.departureIata)
      if (l.arrivalIcao && l.arrivalIata) m.set(l.arrivalIcao.toUpperCase(), l.arrivalIata)
    }
    for (const [icao, a] of airports) if (a.iata && !m.has(icao)) m.set(icao, a.iata)
    return m
  }, [legs, airports])
  const brief: FlightBrief = React.useMemo(
    () => ({
      status,
      now,
      display,
      authority,
      duty: {
        atMs: dutyAtMs,
        current,
        choices,
        index,
        period: choice?.period ?? null,
        fdp,
        restBefore: index > 0 ? (choice?.period?.restBefore ?? null) : null,
        legs,
        times,
        lookups: lookupsClose ? lookups.lookups : null,
        info,
        lookupsLoading: lookups.loading,
        refreshLookups: lookups.refresh,
        estimate,
        standby,
      },
      margin,
      limits: limitDetail,
      recencyLapseIso: recency.lapseIso,
      currencyAsOfMs: currencyAsOfMs ?? now,
      crew,
      legCrew,
      currency,
      destinations,
      airports,
      fleet,
      planned,
      airportInfo,
      runways,
      // The runway in use is NOW, like the METAR — read whatever the duty's distance.
      traffic: isActive,
      weather,
      weatherStation,
      code: (icao: string, iata?: string) =>
        getAirportDisplayCode(icao, iata || iataOf.get((icao || "").toUpperCase()), pref) || icao,
      clock: (ms: number) => formatInstant(ms, display, zone),
      day: (ms: number) =>
        formatDayAt(ms, display?.useZuluTime === false ? zone : "UTC", { year: false }),
    }),
    [status, now, display, authority, dutyAtMs, current, choices, index, choice, fdp, legs, times, lookupsClose, lookups.lookups, info, lookups.loading, lookups.refresh, estimate, standby, margin, limitDetail, recency.lapseIso, currencyAsOfMs, crew, legCrew, currency, destinations, airports, fleet, planned, airportInfo, runways, weather, weatherStation, iataOf, pref, zone, isActive],
  )
  // The airport card's alternates, asked while the page is up (the route reads
  // the stored TAF snapshot — no request to the source): asked only when the
  // card opened, they landed after its morph and the card grew at the end.
  useDutyAlternates(brief, isActive && legs.length > 0)

  /* ── The header's duty menu ──────────────────────────────────────────── */
  // Where each duty GOES and when (the owner, Nov 2026: "I want to see
  // destination and date of duty"): "WIII · Wed, 18 Nov", the report and
  // whether it is the duty now or next under it. Published while the page is
  // on screen.
  const legBriefings = React.useMemo(
    () => legs.map((l) => (l.flightNumber ? flightBriefingId(l) : "")),
    [legs],
  )
  const legNowIndex = Math.max(0, legs.findIndex((l) => !l.inTime) < 0 ? legs.length - 1 : legs.findIndex((l) => !l.inTime))
  const legRoute = legs.length ? [legs[0].departureIcao, ...legs.map((l) => l.arrivalIcao)].join("-") : ""
  React.useEffect(() => {
    if (!isActive) return
    publishDutyChoices(
      choices.length === 0 || dutyAtMs === null
        ? null
        : {
            options: choices.map((c, i) => {
              const sby = c.period?.dutyKind === "standby"
              const dest = sby ? "Standby" : destinationOfRoute(c.period?.route || (i === index ? legRoute : ""), brief.code)
              return {
                value: String(c.atMs),
                label: [dest, brief.day(c.atMs)].filter(Boolean).join(" · "),
                hint: [
                  i === 0 ? (current || (sby && standby?.current) ? "Now" : "Next") : null,
                  `${sby ? "From" : "Report"} ${brief.clock(c.atMs)}`,
                ]
                  .filter(Boolean)
                  .join(" · "),
              }
            }),
            word: index === 0 ? (current || standby?.current ? "Now" : "Next") : "Later",
            day: brief.day(dutyAtMs).replace(/^\w+,?\s*/, ""),
            dest: standby ? "SBY" : destinationOfRoute(choices[index]?.period?.route || legRoute, brief.code),
            atMs: dutyAtMs,
            briefings: legBriefings,
            legNow: legNowIndex,
          },
    )
  }, [isActive, choices, dutyAtMs, current, index, brief, legRoute, legBriefings, legNowIndex, standby])

  /* ── Opening a widget ────────────────────────────────────────────────── */
  // The tile is hidden for its card's whole life: the card's surface covers
  // it exactly when it opens and when it has gone back. On a desktop too —
  // the page takes the whole width, and the detail panel comes back only
  // for a flight opened from a card.
  const [sheet, setSheet] = React.useState<{ id: WidgetId; anchor: WidgetAnchor; size: TileSize } | null>(null)
  // On a standby there are no airports to fly to: that tile steps aside and
  // leaves its cells empty, the others where the pilot put them (the owner,
  // Nov 2026: "not applicable"; a home screen keeps its places). The
  // flight & duty tile reads the standby.
  const shown = React.useMemo(
    () => (standby ? order.filter((id) => id !== "airport") : order),
    [order, standby],
  )
  // Where each tile sits — a card opens from its tile at that size.
  const placedSizes = React.useMemo(
    () =>
      new Map<WidgetId, TileSize>(
        arrangeTiles(shown, positions, columnsOf(grid), rowsOf(grid)).map((p) => [p.id, faceSizeOf({ cols: p.cols, rows: p.rows })]),
      ),
    [shown, positions, grid, faceSizeOf],
  )
  const nav = useWidgetCtx()
  const open = React.useCallback(
    (id: WidgetId, anchor: WidgetAnchor) => {
      setSheet({ id, anchor, size: placedSizes.get(id) ?? CARD_SIZE })
      nav.prefetchSection(id)
    },
    [placedSizes, nav],
  )

  // A flight opened FROM a card goes back to that card (the owner, Nov 2026:
  // "pressing back goes back to flight deck, but the expanded card is no
  // longer expanded"): once the flight it opened is closed — and nothing else
  // chosen, and the page still here — the card grows out of its tile again.
  const { selectedId } = useDetailPanel()
  const reopen = React.useRef<{ id: WidgetId; flightId: string; shown: boolean } | null>(null)
  React.useEffect(() => {
    const r = reopen.current
    if (!r) return
    if (selectedId === r.flightId) {
      r.shown = true
      return
    }
    if (!r.shown) return
    reopen.current = null
    if (selectedId || !isActive) return
    // After the panel's own close has painted: the tile's place is then final.
    const raf = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-widget="${r.id}"]`)
      const b = el?.getBoundingClientRect()
      if (b && b.width > 0) open(r.id, { left: b.left, top: b.top, width: b.width, height: b.height })
    })
    return () => cancelAnimationFrame(raf)
  }, [selectedId, isActive, open])

  // Each tile's face, built once per model: opening a card sets this page's
  // state, and rebuilding every face then (the flights strip, the airport
  // station, a quarter-year of dots) was a third of the open's first task at
  // 4× (Nov 2026). Unchanged elements are skipped by React; the model changes
  // once a minute and with the data, which is when the faces should.
  const placedFaces = React.useMemo(() => {
    const out = new Map<WidgetId, { key: string; face: React.ReactNode }>()
    for (const [id, size] of placedSizes) {
      const fill = grid !== "narrow" || size.rows >= 1.5
      out.set(id, { key: `${size.cols}x${size.rows}:${fill}`, face: faceOf(id, brief, size, false, fill) })
    }
    return out
  }, [placedSizes, brief, grid])
  // A size the tile is not placed at (being resized in Arrange) is drawn fresh.
  const faceFor = (id: WidgetId, size: TileSize) => {
    const fill = fillsRoom(size)
    const hit = placedFaces.get(id)
    return hit && hit.key === `${size.cols}x${size.rows}:${fill}` ? hit.face : faceOf(id, brief, size, false, fill)
  }
  const loading = flightsLoading || statusLoading
  if (loading) {
    return <Skeleton className={cn("h-full min-h-[24rem] rounded-3xl", className)} />
  }

  // Every tile with cause for concern says so with its EDGE (the owner:
  // "instead of just an alert icon, the border … amber or red"), and its
  // reason in the same colour inside it.
  const tint = tileTones(brief)
  const tile = (id: WidgetId, size: TileSize) => (
    <Widget
      id={id}
      label={WIDGET_TITLE[id]}
      hidden={sheet?.id === id}
      onOpen={open}
      tone={tint[id] ?? null}
      className="flex-1"
    >
      {faceFor(id, faceSizeOf(size))}
    </Widget>
  )
  return (
    <div className={cn("@container flex min-h-0 flex-1 flex-col", className)}>
      {/* Scrolls only as a LAST RESORT: every tile fits a phone held upright
          (measured: 360×780 and up). Held sideways it is ~390px tall, and the
          tiles scroll rather than being squeezed out of sight. */}
      <BentoGrid
        grid={grid}
        gridRef={gridRef}
        rowPx={rowPx}
        order={shown}
        positions={positions}
        arranging={arranging}
        label={(id) => WIDGET_TITLE[id]}
        tile={tile}
        face={(id, size) => faceFor(id, faceSizeOf(size))}
      />

      {sheet && (
        <WidgetSheet
          anchor={sheet.anchor}
          title={WIDGET_TITLE[sheet.id]}
          face={faceFor(sheet.id, sheet.size)}
          // The tile opens straight down only where its face IS the card's
          // header: a full-width, one-row tile whose face does not change in
          // the card (the flights face drops its crew panel there; the
          // destination's pages become the card's list).
          // Every card's header is now its title bar over the content (one
          // shell for all five), never the tile's face as it stands — so each
          // crossfades, and what the two share flies.
          seamless={false}
          tone={tint[sheet.id] ?? null}
          // Anything in the card that goes somewhere closes it first.
          render={(dismiss) => {
            const sheetCtx = {
              // A flight opens over this page, not on another route.
              openFlight: (id: string) => {
                reopen.current = { id: sheet.id, flightId: id, shown: false }
                dismiss(() => nav.openFlight(id), { overlay: true })
              },
              go: (href: string) => dismiss(() => nav.go(href)),
              selectDuty,
            }
            const { body, actions, header } = widgetContent(sheet.id, brief, sheetCtx)
            return {
              header: header === "face" ? faceOf(sheet.id, brief, CARD_SIZE, true) : null,
              body,
              actions,
            }
          }}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  )
}
