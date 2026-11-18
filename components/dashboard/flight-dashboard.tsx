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
 * | layout | ONE SCREEN, NO SCROLL — tiles laid out to the height | the same tiles, two columns where the panel is wide |
 * | a tap on a tile | the tile GROWS into a sheet over the page (`WidgetSheet`) | its detail opens in the DETAIL panel beside the page (`w:<id>`) |
 *
 * Every figure comes from ONE model (`FlightBrief`) built once a minute, so a
 * tile, its sheet and the panel cannot disagree. Gates, the inbound aeroplane
 * and the weather are asked by themselves, only while the page is on screen
 * and the duty close enough for them to be published (18h for gates, 30h —
 * a TAF's reach — for weather), and never stored.
 */

import * as React from "react"
import { usePathname } from "next/navigation"
import { useFlights } from "@/hooks/data/use-flights"
import { usePersonnel } from "@/hooks/data/use-crew"
import { useFDPData } from "@/hooks/data/use-fdp-data"
import { usePilotStatus } from "@/hooks/data/use-pilot-status"
import { usePageActive } from "@/hooks/use-page-active"
import { useDayKey } from "@/hooks/use-day-key"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import { useIsDesktop } from "@/hooks/use-is-desktop"
import { useDutyLookups } from "@/hooks/use-duty-lookups"
import { useAirportWeather } from "@/hooks/use-airport-weather"
import { usePreferences } from "@/components/providers/preferences-provider"
import { Skeleton } from "@/components/ui/skeleton"
import { ReadingPanel } from "@/components/ui/detail-form-panel"
import { ninetyDayRecency } from "@/lib/utils/dashboard-aggregate"
import { dutyFlights } from "@/lib/utils/dashboard/duty-flights"
import { describeDuty } from "@/lib/utils/dashboard/duty-line"
import { dutyWindow } from "@/lib/utils/dashboard/duty-status"
import { crewOnDuty, destinationVisits, dutyStations, legTimes } from "@/lib/utils/dashboard/flight-brief"
import { briefStations, stationWindows } from "@/lib/weather/brief"
import { getAirportDisplayCode } from "@/lib/utils/airport-display"
import { formatInstant } from "@/lib/utils/tz-format"
import { formatDayAt } from "@/lib/utils/date"
import { getAirportByIcao, getAirportsRevision } from "@/lib/db/stores/reference/airports.store"
import type { Airport } from "@/types/entities/airport.types"
import { cn } from "@/lib/utils"
import { useTick } from "./flight/instruments"
import { CrewFace, CurrencyFace, DestinationFace, DutyFace, FlightFace, LimitsFace, StatusFace } from "./flight/faces"
import { WeatherFace, type WeatherState } from "./flight/weather"
import { WIDGET_TITLE, WidgetDetail } from "./flight/details"
import { Widget, WidgetSheet, type WidgetAnchor, type WidgetId } from "./flight/widget"
import type { FlightBrief } from "./flight/model"

/** How far either side of now a duty's gates and aeroplane are worth asking about. */
const LOOKUP_WINDOW_MS = 18 * 3600_000
/** How far ahead a TAF reaches: past this the weather is not worth asking. */
const WEATHER_AHEAD_MS = 30 * 3600_000
/** Duties listed under "Coming Up". */
const UPCOMING = 5

const NO_AIRPORTS = new Map<string, Airport>()

/** The airports by ICAO, read from the reference table (and again after any write to it). */
function useAirportsByIcao(icaos: readonly string[]): Map<string, Airport> {
  const key = icaos.join(",")
  const revision = getAirportsRevision()
  const [found, setFound] = React.useState<{ key: string; map: Map<string, Airport> } | null>(null)
  React.useEffect(() => {
    if (!key) return
    let alive = true
    void Promise.all(key.split(",").map((c) => getAirportByIcao(c).catch(() => undefined))).then((airports) => {
      if (!alive) return
      const map = new Map<string, Airport>()
      for (const a of airports) if (a) map.set(a.icao.toUpperCase(), a)
      setFound({ key, map })
    })
    return () => {
      alive = false
    }
  }, [key, revision])
  return found?.key === key ? found.map : NO_AIRPORTS
}

export function FlightDashboard({ className }: { className?: string }) {
  const isActive = usePageActive("/")
  const now = useTick(isActive)
  const { preferences } = usePreferences()
  const display = preferences?.display
  const { flights, isLoading: flightsLoading } = useFlights()
  const { personnel } = usePersonnel()
  const { allDutyPeriods } = useFDPData()
  const dayKey = useDayKey()
  const recency = React.useMemo(
    () => ninetyDayRecency(flights),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dayKey is the "now" input
    [flights, dayKey],
  )
  const { status, isLoading: statusLoading } = usePilotStatus(recency, now, display)

  /* ── The duty the page is about ──────────────────────────────────────── */
  const current = status.duty.phase === "on_duty" && status.duty.active !== null
  const dutyAtMs = current ? status.duty.active!.startMs : (status.duty.next?.reportMs ?? null)
  const legs = React.useMemo(() => (dutyAtMs === null ? [] : dutyFlights(flights, dutyAtMs)), [flights, dutyAtMs])
  const times = React.useMemo(() => legs.map(legTimes), [legs])
  const lookupsClose = dutyAtMs !== null && Math.abs(dutyAtMs - now) <= LOOKUP_WINDOW_MS
  const lookups = useDutyLookups(lookupsClose ? dutyAtMs : null, { active: isActive })
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
  const firstDepart = times[0]?.departMs ?? dutyAtMs
  const destinations = React.useMemo(
    () => (legs.length ? destinationVisits(legs, flights, firstDepart ?? Infinity) : []),
    [legs, flights, firstDepart],
  )
  const stations = React.useMemo(() => dutyStations(legs), [legs])
  const airports = useAirportsByIcao(stations)

  /* ── Weather ─────────────────────────────────────────────────────────── */
  const lastArrive = times.length ? (times[times.length - 1].arriveMs ?? dutyAtMs) : dutyAtMs
  const weatherClose =
    dutyAtMs !== null && dutyAtMs - now <= WEATHER_AHEAD_MS && (lastArrive ?? dutyAtMs) >= now - 3600_000
  const wx = useAirportWeather(stations, isActive && weatherClose && stations.length > 0)
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

  /* ── What comes after ────────────────────────────────────────────────── */
  const upcoming = React.useMemo(() => {
    const after = dutyAtMs ?? now
    return allDutyPeriods
      .map((dp) => ({ dp, w: dutyWindow(dp) }))
      .filter((x) => x.w && x.w.startMs > after + 60_000)
      .sort((a, b) => a.w!.startMs - b.w!.startMs)
      .slice(0, UPCOMING)
      .map((x) => x.dp)
  }, [allDutyPeriods, dutyAtMs, now])

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
      duty: {
        atMs: dutyAtMs,
        current,
        legs,
        times,
        lookups: lookupsClose ? lookups.lookups : null,
        info,
        lookupsLoading: lookups.loading,
        refreshLookups: lookups.refresh,
      },
      crew,
      destinations,
      airports,
      weather,
      upcoming,
      code: (icao: string, iata?: string) =>
        getAirportDisplayCode(icao, iata || iataOf.get((icao || "").toUpperCase()), pref) || icao,
      clock: (ms: number) => formatInstant(ms, display, zone),
      day: (ms: number) =>
        formatDayAt(ms, display?.useZuluTime === false ? zone : "UTC", { year: false }),
    }),
    [status, now, display, dutyAtMs, current, legs, times, lookupsClose, lookups.lookups, info, lookups.loading, lookups.refresh, crew, destinations, airports, weather, upcoming, iataOf, pref, zone],
  )

  /* ── Opening a widget ────────────────────────────────────────────────── */
  const isDesktop = useIsDesktop()
  const { selectedId, setSelectedId, setDetailContent } = useDetailPanel()
  const onDashboard = usePathname() === "/"
  const panelWidget = selectedId?.startsWith("w:") ? (selectedId.slice(2) as WidgetId) : null
  const [sheetState, setSheet] = React.useState<{ id: WidgetId; anchor: WidgetAnchor } | null>(null)
  // A phone that turns into a tablet leaves its sheet behind: the panel is the detail there.
  const sheet = isDesktop ? null : sheetState
  const open = React.useCallback(
    (id: WidgetId, anchor: WidgetAnchor) => {
      if (isDesktop) setSelectedId(`w:${id}`)
      else setSheet({ id, anchor })
    },
    [isDesktop, setSelectedId],
  )
  // The panel beside the page shows the widget it was asked for.
  React.useEffect(() => {
    if (!isActive || !onDashboard || !panelWidget) return
    setDetailContent(
      <ReadingPanel key={panelWidget} title={WIDGET_TITLE[panelWidget] ?? "Detail"}>
        <WidgetDetail id={panelWidget} brief={brief} onNavigate={(go) => go()} />
      </ReadingPanel>,
    )
  }, [isActive, onDashboard, panelWidget, brief, setDetailContent])

  // Beside the page, the panel is never left saying "Select…": with nothing
  // chosen it opens the duty's flights, else the currency list.
  const loading = flightsLoading || statusLoading
  React.useEffect(() => {
    if (!isDesktop || !isActive || !onDashboard || loading || selectedId) return
    setSelectedId(dutyAtMs !== null ? "w:flight" : "w:currency", { explicit: false })
  }, [isDesktop, isActive, onDashboard, loading, selectedId, dutyAtMs, setSelectedId])

  if (loading) {
    return <Skeleton className={cn("h-full min-h-[24rem] rounded-3xl", className)} />
  }

  const tile = (id: WidgetId, face: React.ReactNode, cls?: string) => (
    <Widget
      key={id}
      id={id}
      label={WIDGET_TITLE[id]}
      open={isDesktop && panelWidget === id}
      hidden={sheet?.id === id}
      onOpen={open}
      className={cls}
    >
      {face}
    </Widget>
  )
  const faceOf = (id: WidgetId): React.ReactNode => {
    switch (id) {
      case "status":
        return <StatusFace brief={brief} />
      case "duty":
        return <DutyFace brief={brief} />
      case "flight":
        return <FlightFace brief={brief} />
      case "weather":
        return <WeatherFace weather={weather} code={brief.code} />
      case "crew":
        return <CrewFace brief={brief} />
      case "destination":
        return <DestinationFace brief={brief} />
      case "currency":
        return <CurrencyFace brief={brief} />
      case "limits":
        return <LimitsFace brief={brief} />
    }
  }

  return (
    <div className={cn("@container flex max-h-full min-h-0 flex-col", className)}>
      {/* Scrolls only as a LAST RESORT: every tile fits a phone held upright
          (measured: 360×780 and up). Held sideways it is ~390px tall, and the
          tiles scroll rather than being squeezed out of sight. */}
      <div className="grid min-h-0 grid-cols-6 content-start gap-2 overflow-y-auto overscroll-contain scrollbar-hide @[44rem]:grid-cols-12">
        {tile("status", faceOf("status"), "col-span-6")}
        {tile("duty", faceOf("duty"), "col-span-6")}
        {tile("flight", faceOf("flight"), "col-span-6 @[44rem]:col-span-12")}
        {tile("weather", faceOf("weather"), "col-span-2 @[44rem]:col-span-4")}
        {tile("crew", faceOf("crew"), "col-span-2 @[44rem]:col-span-4")}
        {tile("destination", faceOf("destination"), "col-span-2 @[44rem]:col-span-4")}
        {tile("currency", faceOf("currency"), "col-span-3 @[44rem]:col-span-6")}
        {tile("limits", faceOf("limits"), "col-span-3 @[44rem]:col-span-6")}
      </div>

      {sheet && (
        <WidgetSheet anchor={sheet.anchor} title={WIDGET_TITLE[sheet.id]} face={faceOf(sheet.id)} onClose={() => setSheet(null)}>
          {(close) => <WidgetDetail id={sheet.id} brief={brief} onNavigate={(go) => close(go)} />}
        </WidgetSheet>
      )}
    </div>
  )
}
