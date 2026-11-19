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
import { useCurrencies } from "@/hooks/data/use-currencies"
import { currencySummary } from "@/lib/utils/dashboard/currency-summary"
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
import { fdpMinutesOf } from "@/lib/utils/roster/fdp-calculator"
import { crewOnDuty, destinationVisits, dutyStations, legTimes } from "@/lib/utils/dashboard/flight-brief"
import { briefStations, stationWindows } from "@/lib/weather/brief"
import { getAirportDisplayCode } from "@/lib/utils/airport-display"
import { formatInstant } from "@/lib/utils/tz-format"
import { formatDayAt } from "@/lib/utils/date"
import { getAirportByIcao, getAirportsRevision } from "@/lib/db/stores/reference/airports.store"
import type { Airport } from "@/types/entities/airport.types"
import { cn } from "@/lib/utils"
import { useTick } from "./flight/instruments"
import { CrewFace, CurrencyFace, DestinationFace, DutyFace, DutyStepper, FlightFace, LimitsFace, currencyRows, limitsOf } from "./flight/faces"
import { WeatherFace, type WeatherState } from "./flight/weather"
import { WIDGET_TITLE, useWidgetCtx, widgetContent } from "./flight/details"
import { BentoGrid } from "./flight/bento"
import { setArranging, useArranging, useTileOrder } from "@/hooks/use-dashboard-layout"
import { Widget, WidgetCard, WidgetLabel, WidgetSheet, type WidgetAnchor, type WidgetId } from "./flight/widget"
import { ActionRow, ActionStack } from "@/components/ui/action-row"
import type { DutyChoice, FlightBrief } from "./flight/model"
import type { DutyPeriod } from "@/types/entities/roster.types"
import type { RequirementState } from "@/lib/utils/dashboard/legality"

/** How far either side of now a duty's gates and aeroplane are worth asking about. */
const LOOKUP_WINDOW_MS = 18 * 3600_000
/** How far ahead a TAF reaches: past this the weather is not worth asking. */
const WEATHER_AHEAD_MS = 30 * 3600_000
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

/** What a tile shows — the face its card keeps as a header. */
function faceOf(id: WidgetId, brief: FlightBrief): React.ReactNode {
  switch (id) {
    case "duty":
      return <DutyFace brief={brief} />
    case "flight":
      return <FlightFace brief={brief} />
    case "weather":
      return <WeatherFace weather={brief.weather} code={brief.code} />
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

export function FlightDashboard({ className }: { className?: string }) {
  // Which duty the page is about: null is the default (in progress, else
  // next). Coming back to the page goes back to it.
  const [chosenAt, setChosenAt] = React.useState<number | null>(null)
  const isActive = usePageActive("/", () => {
    setChosenAt(null)
    setArranging(false)
  })
  const order = useTileOrder()
  const arranging = useArranging()
  const now = useTick(isActive)
  const { preferences } = usePreferences()
  const display = preferences?.display
  const { flights, isLoading: flightsLoading } = useFlights()
  const { personnel } = usePersonnel()
  const { currencies } = useCurrencies()
  const { allDutyPeriods } = useFDPData()
  const dayKey = useDayKey()
  const recency = React.useMemo(
    () => ninetyDayRecency(flights),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dayKey is the "now" input
    [flights, dayKey],
  )
  const { status, isLoading: statusLoading } = usePilotStatus(recency, now, display)

  /* ── The duty the page is about ──────────────────────────────────────── */
  const onDuty = status.duty.phase === "on_duty" && status.duty.active !== null
  const defaultAt = onDuty ? status.duty.active!.startMs : (status.duty.next?.reportMs ?? null)
  const defaultId = onDuty ? status.duty.active!.id : (status.duty.next?.id ?? null)
  const choices: DutyChoice[] = React.useMemo(() => {
    const byId = defaultId ? allDutyPeriods.find((dp) => dp.id === defaultId) ?? null : null
    const after = defaultAt ?? now
    const later = allDutyPeriods
      .filter(hasFlying)
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
  const step = React.useCallback(
    (delta: number) => {
      const next = choices[Math.min(choices.length - 1, Math.max(0, index + delta))]
      setChosenAt(next && next !== choices[0] ? next.atMs : null)
    },
    [choices, index],
  )
  const selectDuty = React.useCallback(
    (atMs: number) => setChosenAt(choices[0]?.atMs === atMs ? null : atMs),
    [choices],
  )
  const fdp = React.useMemo(() => {
    if (current || !choice) return null
    if (index === 0 && status.duty.next) {
      const n = status.duty.next
      return n.plannedFdpMinutes > 0 ? { planned: n.plannedFdpMinutes, max: n.maxFdpMinutes } : null
    }
    const dp = choice.period
    return dp && dp.maxFdpMinutes > 0 ? { planned: fdpMinutesOf(dp), max: dp.maxFdpMinutes } : null
  }, [current, choice, index, status.duty.next])
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
  const currency = React.useMemo(() => currencySummary(currencies, dutyAtMs), [currencies, dutyAtMs])
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
      },
      crew,
      currency,
      destinations,
      airports,
      weather,
      code: (icao: string, iata?: string) =>
        getAirportDisplayCode(icao, iata || iataOf.get((icao || "").toUpperCase()), pref) || icao,
      clock: (ms: number) => formatInstant(ms, display, zone),
      day: (ms: number) =>
        formatDayAt(ms, display?.useZuluTime === false ? zone : "UTC", { year: false }),
    }),
    [status, now, display, dutyAtMs, current, choices, index, choice, fdp, legs, times, lookupsClose, lookups.lookups, info, lookups.loading, lookups.refresh, crew, currency, destinations, airports, weather, iataOf, pref, zone],
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
  const nav = useWidgetCtx()
  const ctx = React.useMemo(() => ({ ...nav, selectDuty }), [nav, selectDuty])
  // The panel beside the page shows the widget it was asked for: the same
  // card the phone lifts, its actions as capsules under it.
  React.useEffect(() => {
    if (!isActive || !onDashboard || !panelWidget || !WIDGET_TITLE[panelWidget]) return
    const { body, actions, header } = widgetContent(panelWidget, brief, ctx)
    setDetailContent(
      <ReadingPanel key={panelWidget} title={WIDGET_TITLE[panelWidget]}>
        <WidgetCard face={header === "face" ? faceOf(panelWidget, brief) : null} body={body} />
        {actions.length > 0 && (
          <ActionStack>
            {actions.map((a) => (
              <ActionRow key={a.id} label={a.label} icon={a.icon} disabled={a.busy} onClick={a.run} />
            ))}
          </ActionStack>
        )}
      </ReadingPanel>,
    )
  }, [isActive, onDashboard, panelWidget, brief, ctx, setDetailContent])

  // Beside the page, the panel is never left saying "Select…": with nothing
  // chosen it opens the duty's flights, else the currency list.
  const loading = flightsLoading || statusLoading
  React.useEffect(() => {
    if (!isDesktop || !isActive || !onDashboard || loading || selectedId) return
    setSelectedId(dutyAtMs !== null ? "w:flight" : "w:duty", { explicit: false })
  }, [isDesktop, isActive, onDashboard, loading, selectedId, dutyAtMs, setSelectedId])

  if (loading) {
    return <Skeleton className={cn("h-full min-h-[24rem] rounded-3xl", className)} />
  }

  const reqs = status.legality.requirements
  const tint = {
    currency: worstOf(currencyRows(brief).map((r) => r.state)),
    limits: worstOf(limitsOf(brief).map((r) => r.state)),
  } as Partial<Record<WidgetId, RequirementState | null>>
  const tile = (id: WidgetId) => (
    <Widget
      id={id}
      label={WIDGET_TITLE[id]}
      open={isDesktop && panelWidget === id}
      hidden={sheet?.id === id}
      onOpen={open}
      tone={tint[id] ?? null}
      controls={id === "flight" ? <DutyStepper index={index} count={choices.length} onStep={step} /> : undefined}
      className="flex-1"
    >
      {faceOf(id, brief)}
    </Widget>
  )
  return (
    <div className={cn("@container flex max-h-full min-h-0 flex-col", className)}>
      {/* Scrolls only as a LAST RESORT: every tile fits a phone held upright
          (measured: 360×780 and up). Held sideways it is ~390px tall, and the
          tiles scroll rather than being squeezed out of sight. */}
      <BentoGrid
        order={order}
        arranging={arranging}
        label={(id) => WIDGET_TITLE[id]}
        tile={tile}
        face={(id) => faceOf(id, brief)}
      />

      {sheet &&
        (() => {
          const { body, actions, header } = widgetContent(sheet.id, brief, ctx)
          const face = faceOf(sheet.id, brief)
          return (
            <WidgetSheet
              anchor={sheet.anchor}
              title={WIDGET_TITLE[sheet.id]}
              face={face}
              header={header === "face" ? face : <WidgetLabel>{WIDGET_TITLE[sheet.id]}</WidgetLabel>}
              body={body}
              actions={actions}
              onClose={() => setSheet(null)}
            />
          )
        })()}
    </div>
  )
}
