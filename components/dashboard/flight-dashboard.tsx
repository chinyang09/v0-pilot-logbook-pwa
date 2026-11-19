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
import { Reorder, useDragControls } from "framer-motion"
import { useTick } from "./flight/instruments"
import { DutyStepper, destinationsOf, limitsOf, orderCurrency, shortDay } from "./flight/faces"
import { type WeatherState } from "./flight/weather"
import { WIDGET_TITLE, useWidgetCtx, widgetContent } from "./flight/details"
import { Widget, WidgetCard, WidgetLabel, WidgetSheet, type WidgetAnchor, type WidgetId } from "./flight/widget"
import { AREA_TITLE, AreaGrip, AreaRow, HERO_STEPPER_CLASS, ReadinessHero, areaCardClass } from "./flight/areas"
import { ActionRow, ActionStack } from "@/components/ui/action-row"
import type { DutyChoice, FlightBrief } from "./flight/model"
import type { DutyPeriod } from "@/types/entities/roster.types"
import { inboundLeg } from "@/lib/utils/dashboard/duty-flights"
import {
  aircraftArea,
  crewArea,
  currencyArea,
  destinationArea,
  dutyArea,
  limitsArea,
  readiness,
  weatherArea,
  type AreaStatus,
} from "@/lib/utils/dashboard/area-status"
import { setAreaOrder, setArranging, useAreaOrder, useArranging, type DashboardArea } from "@/hooks/use-dashboard-layout"

/** How far either side of now a duty's gates and aeroplane are worth asking about. */
const LOOKUP_WINDOW_MS = 18 * 3600_000
/** How far ahead a TAF reaches: past this the weather is not worth asking. */
const WEATHER_AHEAD_MS = 30 * 3600_000
/** How many duties ahead the flight card can step to. */
const CHOICES = 14

/** A duty with flying in it — what the flight card can be about. */
const hasFlying = (dp: DutyPeriod) => !dp.dutyKind || dp.dutyKind === "flight" || dp.dutyKind === "positioning"


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

/** Every area's verdict, in words — one pass over the brief. */
function areaStatuses(brief: FlightBrief): Record<DashboardArea, AreaStatus> {
  const { duty, status, code, clock, now, airports } = brief
  const reqs = status.legality.requirements
  const leg = inboundLeg(duty.legs) ?? duty.legs[0] ?? null
  const gate = leg && duty.lookups?.gates[leg.id]?.status === "done" ? (duty.lookups.gates[leg.id] as { status: "done"; gates: { departure: { gate: string } } }).gates.departure.gate : ""
  const nameOf = (icao: string) => {
    const a = airports.get(icao.toUpperCase())
    const place = a?.city || a?.name
    return place ? `${place} (${code(icao)})` : code(icao)
  }
  return {
    duty: dutyArea(status.duty, clock),
    aircraft: aircraftArea({
      registration: leg?.aircraftReg ?? "",
      hasLegs: duty.legs.length > 0,
      lookups: duty.lookups,
      loading: duty.lookupsLoading,
      gate,
      nowMs: now,
      clock,
    }),
    weather: weatherArea({
      briefs: brief.weather.briefs,
      asked: brief.weather.asked,
      failed: brief.weather.failed,
      loading: brief.weather.loading,
      checkedAt: brief.weather.checkedAt,
      code,
    }),
    crew: crewArea(brief.crew, shortDay),
    destination: destinationArea(destinationsOf(brief), nameOf, now),
    currency: currencyArea(orderCurrency(reqs.filter((r) => r.group === "currency"))),
    limits: limitsArea(limitsOf(brief)),
  }
}

/** What a card shows — the face its expanded card keeps as a header. */
function faceOf(
  id: WidgetId,
  brief: FlightBrief,
  areas: Record<DashboardArea, AreaStatus>,
  order: DashboardArea[],
): React.ReactNode {
  if (id === "flight") {
    // An empty logbook has passed nothing — empty limits are not "good to go".
    const verdict =
      brief.status.state === "getting_started"
        ? { tone: "idle" as const, headline: "No flights yet", flagged: 0 }
        : readiness(order.map((a) => areas[a]))
    return <ReadinessHero brief={brief} tones={order.map((a) => areas[a].tone)} verdict={verdict} />
  }
  return <AreaRow id={id} status={areas[id]} opened />
}

export function FlightDashboard({ className }: { className?: string }) {
  // Which duty the page is about: null is the default (in progress, else
  // next). Coming back to the page goes back to it.
  const [chosenAt, setChosenAt] = React.useState<number | null>(null)
  const isActive = usePageActive("/", () => {
    setChosenAt(null)
    setArranging(false)
  })
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
        lookupsLoading: lookups.loading,
        refreshLookups: lookups.refresh,
      },
      crew,
      destinations,
      airports,
      weather,
      code: (icao: string, iata?: string) =>
        getAirportDisplayCode(icao, iata || iataOf.get((icao || "").toUpperCase()), pref) || icao,
      clock: (ms: number) => formatInstant(ms, display, zone),
      day: (ms: number) =>
        formatDayAt(ms, display?.useZuluTime === false ? zone : "UTC", { year: false }),
    }),
    [status, now, display, dutyAtMs, current, choices, index, choice, fdp, legs, times, lookupsClose, lookups.lookups, lookups.loading, lookups.refresh, crew, destinations, airports, weather, iataOf, pref, zone],
  )

  /* ── The areas ───────────────────────────────────────────────────────── */
  const order = useAreaOrder()
  const arranging = useArranging()
  const areas = React.useMemo(() => areaStatuses(brief), [brief])

  /* ── Opening a card ──────────────────────────────────────────────────── */
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
  // The panel beside the page shows the card it was asked for: the same card
  // the phone lifts, its actions as capsules under it.
  React.useEffect(() => {
    if (!isActive || !onDashboard || !panelWidget || !WIDGET_TITLE[panelWidget]) return
    const { body, actions, header } = widgetContent(panelWidget, brief, ctx)
    setDetailContent(
      <ReadingPanel key={panelWidget} title={WIDGET_TITLE[panelWidget]}>
        <WidgetCard face={header === "face" ? faceOf(panelWidget, brief, areas, order) : null} body={body} />
        {actions.length > 0 && (
          <ActionStack>
            {actions.map((a) => (
              <ActionRow key={a.id} label={a.label} icon={a.icon} disabled={a.busy} onClick={a.run} />
            ))}
          </ActionStack>
        )}
      </ReadingPanel>,
    )
  }, [isActive, onDashboard, panelWidget, brief, ctx, areas, order, setDetailContent])

  // Beside the page, the panel is never left saying "Select…": with nothing
  // chosen it opens the duty's flight.
  const loading = flightsLoading || statusLoading
  React.useEffect(() => {
    if (!isDesktop || !isActive || !onDashboard || loading || selectedId) return
    setSelectedId(dutyAtMs !== null ? "w:flight" : "w:duty", { explicit: false })
  }, [isDesktop, isActive, onDashboard, loading, selectedId, dutyAtMs, setSelectedId])

  if (loading) {
    return <Skeleton className={cn("h-full min-h-[24rem] rounded-3xl", className)} />
  }

  return (
    <div className={cn("flex max-h-full min-h-0 flex-col", className)}>
      {/* Scrolls only as a LAST RESORT: the hero and every area fit a phone
          held upright (measured 360×780 and up). */}
      <div className="min-h-0 space-y-1.5 overflow-y-auto overscroll-contain scrollbar-hide">
        <Widget
          id="flight"
          label="Readiness and the next flight"
          open={isDesktop && panelWidget === "flight"}
          hidden={sheet?.id === "flight"}
          disabled={arranging}
          onOpen={open}
          className={cn(arranging && "opacity-60")}
          surface="px-3 pt-3 pb-3"
          controls={!arranging && <DutyStepper index={index} count={choices.length} onStep={step} />}
          controlsClassName={HERO_STEPPER_CLASS}
        >
          {faceOf("flight", brief, areas, order)}
        </Widget>
        {/* The areas, in the pilot's order — dragged by their grip while
            arranging (the header's Arrange). */}
        {/* Reorder only WHILE arranging: its items are layout-projected, so
            every render measures them — a forced layout on every minute's tick
            and every tab switch, for a drag nobody is making. */}
        {arranging ? (
          <Reorder.Group as="div" axis="y" values={order} onReorder={setAreaOrder} className="space-y-1.5">
            {order.map((id) => (
              <AreaItem key={id} id={id} status={areas[id]} arranging open={false} hidden={false} onOpen={open} />
            ))}
          </Reorder.Group>
        ) : (
          <div className="space-y-1.5">
            {order.map((id) => (
              <Widget
                key={id}
                id={id}
                label={AREA_TITLE[id]}
                open={isDesktop && panelWidget === id}
                hidden={sheet?.id === id}
                onOpen={open}
                surface={cn("px-3 py-2", areaCardClass(areas[id].tone))}
              >
                <AreaRow id={id} status={areas[id]} />
              </Widget>
            ))}
          </div>
        )}
      </div>

      {sheet &&
        (() => {
          const { body, actions, header } = widgetContent(sheet.id, brief, ctx)
          const face = faceOf(sheet.id, brief, areas, order)
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

/** One area: its row, and — while arranging — the grip it is dragged by. */
function AreaItem({
  id,
  status,
  arranging,
  open,
  hidden,
  onOpen,
}: {
  id: DashboardArea
  status: AreaStatus
  arranging: boolean
  open: boolean
  hidden: boolean
  onOpen: (id: WidgetId, anchor: WidgetAnchor) => void
}) {
  const controls = useDragControls()
  return (
    <Reorder.Item
      as="div"
      value={id}
      dragListener={false}
      dragControls={controls}
      whileDrag={{ scale: 1.02, zIndex: 10 }}
      className="relative"
    >
      <Widget
        id={id}
        label={AREA_TITLE[id]}
        open={open}
        hidden={hidden}
        disabled={arranging}
        onOpen={onOpen}
        surface={cn("px-3 py-2", areaCardClass(status.tone), arranging && "pr-14")}
        controls={arranging && <AreaGrip label={AREA_TITLE[id]} onPointerDown={(e) => controls.start(e)} />}
        controlsClassName="right-1 top-1/2 -translate-y-1/2"
      >
        <AreaRow id={id} status={status} arranging={arranging} />
      </Widget>
    </Reorder.Item>
  )
}
