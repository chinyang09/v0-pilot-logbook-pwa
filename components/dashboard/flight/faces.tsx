"use client"

/**
 * What each widget shows on the page — the glance. Everything here is ONE
 * line per fact, truncated rather than wrapped, so a tile is the same height
 * whatever it says (the page is laid out to a phone's height and must not
 * move as the answers land). The detail behind each is in `details.tsx`.
 */

import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronDown, OctagonAlert, TriangleAlert } from "lucide-react"
import { ChoicePicker } from "@/components/ui/option-menu"
import type { Requirement } from "@/lib/utils/dashboard/legality"
import type { SectorLeg } from "@/lib/utils/dashboard/duty-status"
import { formatDay } from "@/lib/utils/date"
import { cn } from "@/lib/utils"
import { dutyWindow, formatDutyClock, formatRestSpan } from "@/lib/utils/dashboard/duty-status"
import { DutyBand, REQ_TONE, STATE_ICON, TONE } from "./instruments"
import { WidgetLabel } from "./widget"
import { getAirportLocalTime, getAirportTimeInfo } from "@/lib/db/stores/reference/airports.store"
import { formatTimezoneOffset } from "@/lib/utils/time"
import { metarConditions } from "@/lib/weather/brief"
import { favouredRunway, runwayEndsFrom, type WindOnRunway } from "@/lib/weather/runway-wind"
import { CATEGORY_TEXT } from "./weather"
import { greatCircleNm } from "@/lib/utils/geo"
import { hasCoordinates } from "@/lib/utils/flight-calculations"
import type { FlightBrief } from "./model"
import type { TileSize } from "@/lib/utils/dashboard/bento"
import { PILOT_ROLES, roleLabel, type LogbookAuthority } from "@/lib/utils/logbook-rules"
import type { PilotRole } from "@/types/entities/flight.types"
import { addDays, localDayKey, lookAheadFor, type LookAhead } from "@/lib/utils/dashboard/currency-dots"
import { CurrencyDots } from "./currency-dots"
import * as React from "react"

/** "18 Nov" — a stored day, as a tile has room for it. */
export const shortDay = (ymd: string) => formatDay(ymd, { weekday: false, year: false })

/** "Woon Kok Heng, Benson" → "Woon Kok Heng": the name before the given name. */
export const shortName = (name: string) => name.split(",")[0].trim()

/* ── Duty clock ──────────────────────────────────────────────────────────── */

/**
 * Duty and rest, one card: where the pilot stands now and what it asks of
 * them, in the tone of that answer alone. A lapsed currency is the currency
 * card's to say — it used to lead this one ("Tightest 90-Day Recency") and
 * then said it again two cards down.
 */
export function DutyFace({ brief }: { brief: FlightBrief }) {
  return (
    <>
      <div
        aria-hidden
        className={cn("pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b to-transparent", TONE[brief.status.dutyState].glow)}
      />
      <div className="relative">
        <DutyBand status={brief.status} now={brief.now} display={brief.display} />
      </div>
    </>
  )
}

/* ── This / next duty ────────────────────────────────────────────────────── */

/** The chain's legs: the logbook's own, each with its progress; else the route the duty carries. */
export function chainOf(brief: FlightBrief): { legs: SectorLeg[]; route?: string } {
  const { duty, status, code } = brief
  if (duty.legs.length > 0) {
    return {
      legs: duty.legs.map((f) => ({
        from: code(f.departureIcao, f.departureIata),
        to: code(f.arrivalIcao, f.arrivalIata),
        status: f.inTime ? "complete" : f.outTime ? "active" : "scheduled",
      })),
    }
  }
  if (duty.current && status.duty.active) return { legs: status.duty.active.legs }
  return { legs: [], route: status.duty.next?.route }
}

/** "Now", "Next", "Later" — which duty the card is about. */
export function dutyWord(brief: FlightBrief): string {
  return brief.duty.current ? "Now" : brief.duty.index === 0 ? "Next" : "Later"
}

/** The rest before a later duty, against its own minimum: "Rest 15:20 · Min 12:00". */
export function restBeforeText(brief: FlightBrief): { text: string; short: boolean } | null {
  const r = brief.duty.restBefore
  if (!r) return null
  return { text: `Rest ${formatRestSpan(r.restMinutes)} · Min ${formatDutyClock(r.requiredRestMinutes)}`, short: !r.compliant }
}

/**
 * The duty laid on its day (the owner's duty-and-crew widget): a 24-hour
 * strip in the pilot's clock — a tick each hour, a taller one every six with
 * its hour under it — the duty from report to off duty as a track, each leg
 * filled on it (flown in ink, still to fly in the accent) and now as a
 * hairline. The track and the legs are squared off (the owner: so their left
 * and right ends read), and a duty past midnight moves the window on so it is
 * all in view.
 */
function DayBar({ brief }: { brief: FlightBrief }) {
  const { duty, now, display } = brief
  const zulu = display?.useZuluTime !== false
  const legs = duty.times
  const w = duty.period ? dutyWindow(duty.period) : null
  const start0 = w?.startMs ?? duty.atMs
  if (start0 === null) return null
  const end0 = w?.endMs ?? Math.max(...legs.map((t) => t.arriveMs ?? 0), start0 + 3600_000)
  const H = 3600_000
  const dayStart = (ms: number) => {
    const d = new Date(ms)
    return zulu ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) : new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  }
  let from = dayStart(start0)
  while (end0 > from + 24 * H && from + 6 * H <= start0) from += 6 * H
  const to = from + 24 * H
  const pct = (ms: number) => `${Math.max(0, Math.min(100, ((ms - from) / (to - from)) * 100))}%`
  const span = (a: number, b: number) => ({ left: pct(a), width: `calc(${pct(b)} - ${pct(a)})` })
  const hourOf = (ms: number) => (zulu ? new Date(ms).getUTCHours() : new Date(ms).getHours())
  return (
    <div aria-hidden className="mb-1.5">
      <div className="relative h-[18px]">
        {/* The six-hourly lines run through the strip, behind the duty. */}
        {[0, 6, 12, 18, 24].map((h) => (
          <span key={h} className="absolute inset-y-0 w-px bg-border" style={{ left: pct(from + h * H) }} />
        ))}
        <span className="absolute inset-y-0 rounded-[3px] border border-foreground/30 bg-muted" style={span(start0, end0)} />
        {legs.map((t, i) =>
          t.departMs !== null && t.arriveMs !== null ? (
            <span
              key={i}
              className={cn("absolute inset-y-[3px] rounded-[2px]", duty.legs[i]?.inTime ? "bg-foreground/55" : "bg-primary")}
              style={span(t.departMs, t.arriveMs)}
            />
          ) : null,
        )}
        {now > from && now < to && <span className="absolute -inset-y-0.5 w-0.5 rounded-full bg-foreground" style={{ left: pct(now) }} />}
      </div>
      {/* A tick each hour, the six-hourly ones taller. */}
      <div className="relative h-1.5">
        {Array.from({ length: 25 }, (_, h) => (
          <span
            key={h}
            className={cn("absolute top-0 w-px", h % 6 === 0 ? "h-1.5 bg-foreground/45" : "h-1 bg-foreground/20")}
            style={{ left: pct(from + h * H) }}
          />
        ))}
      </div>
      <div className="relative h-3 text-[9px] tabular-nums text-muted-foreground">
        {[0, 6, 12, 18].map((h) => (
          <span key={h} className="absolute" style={{ left: pct(from + h * H) }}>
            {String(hourOf(from + h * H)).padStart(2, "0")}
          </span>
        ))}
        <span className="absolute right-0">{zulu ? "Z" : "L"}</span>
      </div>
    </div>
  )
}

/** A crew member's seat as the pilot's logbook rules name it ("PIC", "P2"); a relief pilot is "Relief". */
export function crewRole(role: string, authority: LogbookAuthority): string {
  if ((PILOT_ROLES as readonly string[]).includes(role)) return roleLabel(role as PilotRole, authority)
  return /relief/i.test(role) ? "Relief" : role
}

/**
 * The crew beside the duty: initials, the name, their seat and how often flown
 * together — on the right where the tile spans the row, under the duty in a
 * narrower tile two rows tall.
 */
function CrewPanel({ brief, below = false }: { brief: FlightBrief; below?: boolean }) {
  const { crew } = brief
  const shown = crew.slice(0, 3)
  const role = (r: string) => crewRole(r, brief.authority)
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col justify-center gap-1.5 border-border/70 bg-muted/50",
        below ? "-mx-3 -mb-3 mt-2 flex-1 border-t px-3 py-2" : "-my-3 -mr-3 ml-3 w-[40%] max-w-44 rounded-r-2xl border-l px-2.5 py-3",
      )}
    >
      {shown.length === 0 ? (
        <p className="text-xs text-muted-foreground">No crew yet</p>
      ) : (
        shown.map((m) => (
          <div key={m.personId ?? m.name} className="flex min-w-0 items-center gap-1.5" data-morph={`crew-${m.personId ?? m.name}`}>
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-card text-[9px] font-semibold text-foreground">
              {initialsOf(m.name)}
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-[12px] font-medium text-foreground">{shortName(m.name)}</span>
              <span className="block truncate text-[10px] tabular-nums text-muted-foreground">
                {[role(m.role), m.last ? (m.count ? `${m.count}×` : null) : "New"].filter(Boolean).join(" · ")}
              </span>
            </span>
          </div>
        ))
      )}
      {crew.length > shown.length && <p className="pl-7 text-[11px] text-muted-foreground">+ {crew.length - shown.length} more</p>}
    </div>
  )
}

/** "Woon Kok Heng" → "WK". */
export function initialsOf(name: string): string {
  const parts = shortName(name).split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?"
}

/**
 * The chosen duty and who flies it, one tile (the owner's duty-and-crew
 * widget, Nov 2026): the date line (a menu of duties), the duty on its day,
 * the route in large type, the times and flight numbers, then the aeroplane
 * line (where it is, the gate) — and the crew in a panel beside it. The card
 * has each leg with its times and gates, and every crew member.
 */
export function FlightFace({ brief, size, inCard = false }: { brief: FlightBrief; size: TileSize; inCard?: boolean }) {
  const { duty, clock, day } = brief
  // The crew: beside the duty across the row, under it in a tall narrower
  // tile, and not at all in the card's header — the card lists every member
  // under the legs (the owner: the card takes the full width).
  const crewAt = inCard ? null : size.cols >= 3 ? "side" : size.rows >= 2 ? "below" : null
  const { legs, route } = chainOf(brief)
  if (duty.atMs === null) {
    return (
      <>
        <WidgetLabel>Next</WidgetLabel>
        <p className="text-sm font-medium text-muted-foreground">Nothing rostered</p>
      </>
    )
  }
  const reg = duty.legs.find((l) => !l.inTime && l.aircraftReg)?.aircraftReg || duty.legs[0]?.aircraftReg || ""
  const numbers = duty.legs.map((l) => l.flightNumber).filter(Boolean)
  const rest = restBeforeText(brief)
  const line = duty.info?.line ?? [reg, rest?.text].filter(Boolean).join(" · ")
  const stops = legs.length ? [legs[0].from, ...legs.map((l) => l.to)] : (route ?? "").split("-").filter(Boolean)
  const first = duty.times[0]?.departMs ?? null
  const last = duty.times[duty.times.length - 1]?.arriveMs ?? null
  const remaining = duty.legs.filter((l) => !l.inTime).length
  // The next leg's departure gate — under its stop before; on the line now.
  const nextIdx = Math.max(0, duty.legs.findIndex((l) => !l.inTime))
  const gate = duty.info?.legGates[nextIdx]?.dep ?? ""
  return (
    <div className={cn("flex min-w-0", crewAt === "below" && "flex-1 flex-col")}>
      {/* A container: on a phone the crew panel leaves the route ~190px, and a
          three-stop route at 21px does not fit it (measured at 360). */}
      <div className={cn("@container min-w-0", crewAt !== "below" && "flex-1")}>
        <WidgetLabel>
          <span className="inline-flex items-center gap-0.5" suppressHydrationWarning>
            {dutyWord(brief)} · {day(duty.atMs)}
            {duty.choices.length > 1 && <ChevronDown className="h-3 w-3" aria-hidden />}
          </span>
        </WidgetLabel>
        <DayBar brief={brief} />
        <p className="truncate text-[17px] font-bold leading-tight tracking-tight text-foreground @[15rem]:text-[21px]">
          {stops.join(stops.length > 2 ? "–" : " – ") || "—"}
        </p>
        <p className="mt-0.5 flex items-baseline justify-between gap-1.5 text-[12px] tabular-nums" suppressHydrationWarning>
          <span className="shrink-0 text-foreground">{first !== null && last !== null ? `${clock(first).replace(/Z$/, "")}–${clock(last)}` : ""}</span>
          {duty.fdp && (
            // What this duty ASKS of the pilot: its FDP against its own Reg 14 maximum.
            <span
              className={cn(
                "min-w-0 truncate",
                duty.fdp.max > 0 && duty.fdp.planned > duty.fdp.max ? "font-semibold text-destructive" : "text-muted-foreground",
              )}
            >
              FDP {formatDutyClock(duty.fdp.planned)}
              {duty.fdp.max > 0 && `/${formatDutyClock(duty.fdp.max)}`}
            </span>
          )}
        </p>
        <p
          className={cn("mt-0.5 truncate text-[11px] leading-tight", !duty.info && rest?.short ? "text-destructive" : "text-muted-foreground")}
          suppressHydrationWarning
        >
          {[
            numbers.join("/").replace(/\/([A-Z]{2})(\d)/g, (_, _a, d) => `/${d}`) || null,
            duty.current && remaining > 0 ? (remaining === 1 ? "One more leg" : `${remaining} more legs`) : null,
            gate ? `Gate ${gate}` : null,
            line,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      {crewAt && <CrewPanel brief={brief} below={crewAt === "below"} />}
    </div>
  )
}

/**
 * Which duty the dashboard is about — chosen by tapping the flight tile's own
 * date line ("NEXT · WED, 18 NOV ⌄"), a menu of the duties ahead (the owner:
 * not ‹ ›). It sits OVER that line, outside the tile's button (a button in a
 * button is not one a keyboard or a screen reader can use).
 */
export function DutyChooser({ brief, onChoose }: { brief: FlightBrief; onChoose: (atMs: number) => void }) {
  const { duty, day, clock } = brief
  if (duty.choices.length < 2 || duty.atMs === null) return null
  // The day leads (the menu is narrow on a phone); the report and the route
  // are its second line.
  const options = duty.choices.map((c, i) => ({
    value: String(c.atMs),
    label: i === 0 ? `${duty.current ? "Now" : "Next"} · ${day(c.atMs)}` : day(c.atMs),
    // The report first: the route is the part that can truncate.
    hint: [`Report ${clock(c.atMs)}`, (c.period?.route ?? "").replace(/-/g, " ")].filter(Boolean).join(" · "),
  }))
  return (
    <ChoicePicker
      label="Duty"
      value={String(duty.atMs)}
      options={options}
      onValueChange={(v) => onChoose(Number(v))}
      align="start"
      className="block h-7 w-48 max-w-[70vw] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="sr-only">Choose the duty</span>
    </ChoicePicker>
  )
}

/* ── Destinations ────────────────────────────────────────────────────────── */

/** The airports worth asking "when was I last there" about — not where the duty starts. */
export function destinationsOf(brief: FlightBrief) {
  const origin = (brief.duty.legs[0]?.departureIcao || "").toUpperCase()
  return brief.destinations.filter((d) => d.icao !== origin)
}

/** The great-circle distance of the leg that lands at `icao`, nm. */
export function distanceInto(brief: FlightBrief, icao: string): number | null {
  const leg = brief.duty.legs.find((l) => (l.arrivalIcao || "").toUpperCase() === icao)
  const from = leg ? brief.airports.get((leg.departureIcao || "").toUpperCase()) : undefined
  const to = brief.airports.get(icao)
  if (!from || !to || !hasCoordinates(from) || !hasCoordinates(to)) return null
  return greatCircleNm({ lat: from.latitude, lon: from.longitude }, { lat: to.latitude, lon: to.longitude })
}

/** The runway the wind favours at a destination, from its runways and its METAR. */
export function favouredAt(brief: FlightBrief, icao: string): WindOnRunway | null {
  const info = brief.airportInfo[icao]
  const raw = brief.weather.briefs.find((b) => b.station === icao)?.metar?.raw
  if (!info || !raw) return null
  const c = metarConditions(raw)
  return favouredRunway(runwayEndsFrom(info.runways), c.windDir ?? null, c.windKt)
}

/** "25R ↓13 →7" — the favoured runway, its head (or tail, amber) and crosswind. */
export function RunwayWind({ fav, className }: { fav: WindOnRunway; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 tabular-nums", className)}>
      <span className="font-semibold text-foreground">{fav.end.ident}</span>
      <span className={cn("inline-flex items-center", fav.headKt < 0 ? "font-semibold text-status-warning" : "text-foreground")}>
        {fav.headKt < 0 ? <ArrowUp className="h-3 w-3" aria-label="tailwind" /> : <ArrowDown className="h-3 w-3" aria-label="headwind" />}
        {Math.abs(fav.headKt)}
      </span>
      {fav.crossKt > 0 && (
        <span className="inline-flex items-center text-foreground">
          {fav.crossFrom === "L" ? <ArrowRight className="h-3 w-3" aria-label="crosswind from the left" /> : <ArrowLeft className="h-3 w-3" aria-label="crosswind from the right" />}
          {fav.crossKt}
        </span>
      )}
    </span>
  )
}

/**
 * Pages a tile can be SWIPED between (the owner: "allow the airport widget to
 * be swipable"), with a dot for each under them. A swipe is pointer events on
 * a transformed track, not a scroller — the tile is a button, and a scroller
 * inside one is not one every engine scrolls — and a swipe never opens the
 * card (its click is swallowed). A vertical move is left to the page.
 */
function Pager({ count, start, children }: { count: number; start: number; children: (i: number) => React.ReactNode }) {
  const [page, setPage] = React.useState(start)
  const track = React.useRef<HTMLDivElement>(null)
  const drag = React.useRef<{ x0: number; y0: number; dx: number; w: number; active: boolean } | null>(null)
  const swiped = React.useRef(false)
  if (count < 2) return <>{children(0)}</>
  const settle = (to: number) => {
    const el = track.current
    if (el) {
      el.style.transition = ""
      el.style.transform = `translateX(${-to * 100}%)`
    }
    setPage(to)
  }
  return (
    <div
      className="relative overflow-hidden"
      style={{ touchAction: "pan-y" }}
      onPointerDown={(e) => {
        swiped.current = false
        drag.current = { x0: e.clientX, y0: e.clientY, dx: 0, w: e.currentTarget.getBoundingClientRect().width, active: false }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        const dx = e.clientX - d.x0
        const dy = e.clientY - d.y0
        if (!d.active) {
          if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
            d.active = true
            e.currentTarget.setPointerCapture(e.pointerId)
          } else if (Math.abs(dy) > 8) drag.current = null
          return
        }
        // Past the first or last page it gives a little, no more.
        const edge = (page === 0 && dx > 0) || (page === count - 1 && dx < 0)
        d.dx = edge ? dx / 4 : dx
        swiped.current = true
        const el = track.current
        if (el) {
          el.style.transition = "none"
          el.style.transform = `translateX(calc(${-page * 100}% + ${d.dx}px))`
        }
      }}
      onPointerUp={() => {
        const d = drag.current
        drag.current = null
        if (!d?.active) return
        const next = d.dx < -d.w * 0.18 ? page + 1 : d.dx > d.w * 0.18 ? page - 1 : page
        settle(Math.max(0, Math.min(count - 1, next)))
      }}
      onPointerCancel={() => {
        if (drag.current?.active) settle(page)
        drag.current = null
      }}
      onClickCapture={(e) => {
        if (!swiped.current) return
        swiped.current = false
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <div
        ref={track}
        className="flex transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
        style={{ transform: `translateX(${-page * 100}%)` }}
      >
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="w-full shrink-0" aria-hidden={i !== page || undefined}>
            {children(i)}
          </div>
        ))}
      </div>
      <div aria-hidden className="mt-1.5 flex justify-center gap-1">
        {Array.from({ length: count }, (_, i) => (
          <span key={i} className={cn("h-1.5 w-1.5 rounded-full transition-colors", i === page ? "bg-foreground" : "bg-foreground/25")} />
        ))}
      </div>
    </div>
  )
}

/** One destination as the tile has it: code and category, place, local time and zone, distance and last visit, the favoured runway. */
function DestinationPage({ brief, icao }: { brief: FlightBrief; icao: string }) {
  const d = brief.destinations.find((x) => x.icao === icao)
  const a = brief.airports.get(icao)
  const nm = distanceInto(brief, icao)
  const fav = favouredAt(brief, icao)
  const cat = brief.weather.briefs.find((b) => b.station === icao)?.metar?.category ?? null
  const local = a?.tz ? getAirportLocalTime(a.tz).split(" ")[0] : null
  const zone = a?.tz ? formatTimezoneOffset(getAirportTimeInfo(a.tz).offset) : null
  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[17px] font-bold leading-tight tracking-tight text-foreground" data-morph={`dest-code-${icao}`}>
          {brief.code(icao)}
        </span>
        {cat && cat !== "VFR" && (
          <span className={cn("shrink-0 text-[13px] font-semibold", CATEGORY_TEXT[cat])} data-morph={`dest-cat-${icao}`}>
            {cat}
          </span>
        )}
      </div>
      <p className="truncate text-[11px] uppercase tracking-wide text-muted-foreground" data-morph={`dest-place-${icao}`}>
        {a?.city || a?.name || "\u00a0"}
      </p>
      {local && (
        <p className="mt-1.5 truncate text-[20px] font-semibold leading-none tabular-nums text-foreground" suppressHydrationWarning>
          <span data-morph={`dest-time-${icao}`}>{local}</span>
          <span className="ml-1 text-[11px] font-medium text-muted-foreground">{zone}</span>
        </p>
      )}
      <p className="mt-1 truncate text-[11px] tabular-nums text-muted-foreground">
        {nm !== null && <span data-morph={`dest-dist-${icao}`}>{Math.round(nm).toLocaleString("en-US")}nm</span>}
        {nm !== null && " · "}
        {d?.last ? `Last ${shortDay(d.last.date)}` : "First time"}
      </p>
      {fav && (
        <p className="mt-1.5 text-[12px]" data-morph={`dest-rwy-${icao}`}>
          <RunwayWind fav={fav} />
        </p>
      )}
    </>
  )
}

/**
 * Where the duty is going (the owner: time and zone there, how far, when last
 * there, its runways and whether it is IFR — at a glance). One destination a
 * page, in the order the duty reaches them, opening on the one it goes to
 * next; swipe for the others.
 */
export function DestinationFace({ brief }: { brief: FlightBrief; size?: TileSize; inCard?: boolean }) {
  const dests = destinationsOf(brief)
  if (dests.length === 0) {
    return (
      <>
        <WidgetLabel>Destination</WidgetLabel>
        <p className="text-xs leading-snug text-muted-foreground">—</p>
      </>
    )
  }
  const start = Math.max(0, dests.findIndex((d) => d.icao === brief.weatherStation))
  return (
    <Pager key={dests.map((d) => d.icao).join() + start} count={dests.length} start={start}>
      {(i) => <DestinationPage brief={brief} icao={dests[i].icao} />}
    </Pager>
  )
}

/* ── Currency and limits ─────────────────────────────────────────────────── */

function Tally({ rows }: { rows: Array<{ state: Requirement["state"] }> }) {
  const requirements = rows
  const fail = requirements.filter((r) => r.state === "fail").length
  const caution = requirements.filter((r) => r.state === "caution" || r.state === "unknown").length
  return (
    <span className="flex items-center gap-1.5 text-[10px] font-semibold tabular-nums">
      {fail > 0 && (
        <span className="inline-flex items-center gap-0.5 text-destructive">
          <OctagonAlert className="h-2.5 w-2.5" aria-hidden />
          {fail}
        </span>
      )}
      {caution > 0 && (
        <span className="inline-flex items-center gap-0.5 text-status-warning">
          <TriangleAlert className="h-2.5 w-2.5" aria-hidden />
          {caution}
        </span>
      )}
      {/* Dark cockpit: all met lights nothing. */}
    </span>
  )
}

/** One line of the currency tile: a logbook requirement (recency, sectors not logged) or a document. */
export interface CurrencyRow {
  key: string
  name: string
  state: Requirement["state"]
  figure: string
  /** The last valid day — the dot it lights — or null for what has no expiry (sectors not logged). */
  ymd: string | null
}

const SEVERITY: Record<Requirement["state"], number> = { fail: 0, unknown: 1, caution: 1, ok: 2 }

/**
 * Everything the currency tile summarises, most pressing first: the logbook's
 * own requirements (90-day recency, sectors not logged, a read that failed)
 * and every document on the Currencies page, by the NAME that page gives it.
 * Within a state, the order is the page's — soonest first.
 */
export function currencyRows(brief: FlightBrief): CurrencyRow[] {
  // 90-day recency is the one that usually binds (the rest are a year long
  // and renewed on the ground), so it leads — and it is judged against the
  // DUTY, not today: recency that lapses before the report does not cover it.
  const lapseMs = brief.recencyLapseIso ? Date.parse(`${brief.recencyLapseIso}T00:00:00Z`) : NaN
  const logbook = brief.status.legality.requirements
    .filter((r) => r.group === "currency" && !r.id.startsWith("doc-"))
    .map((r) => {
      const beforeDuty =
        r.id === "recency" && r.state !== "fail" && brief.duty.atMs !== null && Number.isFinite(lapseMs) && lapseMs <= brief.duty.atMs
      return {
        key: r.id,
        name: r.id === "recency" ? "Recency 90d" : r.label,
        state: beforeDuty ? ("caution" as const) : r.state,
        figure: beforeDuty ? `${r.value} · before duty` : r.value,
        // Recency's last current day; lapsed (or never current), it is today's.
        ymd: r.id === "recency" ? (brief.recencyLapseIso && r.state !== "fail" ? addDays(brief.recencyLapseIso, -1) : "0000-01-01") : null,
      }
    })
  const docs = [...brief.currency.attention, ...brief.currency.current].map((l) => ({
    key: `doc-${l.id}`,
    name: l.name,
    state: l.state,
    figure: l.lapsesBeforeDuty ? `${l.figure} · before duty` : l.figure,
    ymd: l.expiryDate || null,
  }))
  // Recency first whatever its state; then the documents, most pressing first.
  const [recency, others] = [logbook.filter((r) => r.key === "recency"), logbook.filter((r) => r.key !== "recency")]
  return [...recency, ...[...others, ...docs].sort((a, b) => SEVERITY[a.state] - SEVERITY[b.state])]
}

/**
 * The currencies in the order they run out: what has already gone (and what
 * is wrong now with no date — sectors not logged) first, then by expiry, the
 * more pressing first on a tie. The first is the CLOSEST, the dot ringed.
 */
export function currenciesBySoonest(rows: CurrencyRow[]): CurrencyRow[] {
  const at = (r: CurrencyRow) => (r.ymd === null ? (r.state === "ok" ? "9999" : "0000") : r.ymd)
  return [...rows].sort((a, b) => at(a).localeCompare(at(b)) || SEVERITY[a.state] - SEVERITY[b.state])
}

/** "90d", "6m", "1y" — how far the dots look, said beside the tile's label. */
const AHEAD_SHORT: Record<LookAhead, string> = { "90d": "90d", "6m": "6m", "1y": "1y" }

/**
 * The currencies on a DOT CALENDAR (the owner, Nov 2026): a dot a day, looking
 * 90 days, six months or a year ahead as the tile is a third, two thirds or
 * the whole row wide, each expiry a dot lit in its state's colour and the
 * closest ringed — then the closest by name (more of them in a tile two rows
 * tall). The tally counts what is flagged past the rows named.
 */
export function CurrencyFace({ brief, size }: { brief: FlightBrief; size: TileSize }) {
  const all = currenciesBySoonest(currencyRows(brief))
  const ahead = lookAheadFor(size.cols)
  // A third of the row names the closest only, its figure under its name.
  const narrow = size.cols < 2
  const lines = size.rows >= 2 ? (narrow ? 3 : 6) : narrow ? 1 : 2
  const marks = all.filter((r) => r.ymd !== null).map((r) => ({ key: r.key, name: r.name, state: r.state, ymd: r.ymd! }))
  return (
    <>
      {/* A third of the row has no room for the tally beside the label: its
          edge and the dots' colours carry what is flagged. */}
      <WidgetLabel right={narrow ? undefined : <Tally rows={all.slice(lines)} />}>
        Currency
        {!narrow && <span className="font-medium normal-case tracking-normal"> · {AHEAD_SHORT[ahead]}</span>}
      </WidgetLabel>
      {all.length === 0 ? (
        <p className="text-xs leading-snug text-muted-foreground">None tracked</p>
      ) : (
        <>
          <CurrencyDots today={localDayKey(brief.now)} ahead={ahead} marks={marks} closest={marks[0]?.key ?? null} className="mb-1" />
          <ul className="space-y-1">
            {all.slice(0, lines).map((r) => {
              const Icon = STATE_ICON[r.state]
              return (
                // No gutter for an icon a met row does not have: the flag, when
                // there is one, follows the figure.
                <li key={r.key} className={cn("flex items-center gap-1 text-xs leading-tight", narrow && "flex-wrap")}>
                  <span className={cn("min-w-0 flex-1 truncate text-foreground", narrow && "basis-full")} data-morph={`cur-name-${r.key}`}>
                    {r.name}
                  </span>
                  <span
                    className={cn("shrink-0 font-semibold tabular-nums", r.state === "ok" ? "text-foreground" : REQ_TONE[r.state].icon)}
                    data-morph={`cur-fig-${r.key}`}
                  >
                    {r.figure.split(" · ")[0]}
                  </span>
                  {r.state !== "ok" && <Icon className={cn("h-3 w-3 shrink-0", REQ_TONE[r.state].icon)} aria-label={r.state === "fail" ? "Not met" : "Attention"} />}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </>
  )
}

const LIMIT_ORDER = ["duty-14", "duty-28", "flight-28", "flight-365"]

export function limitsOf(brief: FlightBrief): Requirement[] {
  const byId = new Map(brief.status.legality.requirements.filter((r) => r.group === "limits").map((r) => [r.id, r]))
  return LIMIT_ORDER.map((id) => byId.get(id)).filter((r): r is Requirement => !!r)
}

/**
 * How much later the chosen duty can run inside every limit — the FDP's and
 * every rolling window's — as a figure; amber under an hour, red at none.
 */
export function marginText(minutes: number): string {
  // A day and more is said in hours: "+69h", not "+69:21".
  return minutes >= 24 * 60 ? `${Math.floor(minutes / 60)}h` : formatDutyClock(minutes)
}

export function marginTone(minutes: number): string {
  return minutes <= 0 ? "text-destructive" : minutes < 60 ? "text-status-warning" : "text-foreground"
}

export function LimitsFace({ brief, size }: { brief: FlightBrief; size?: TileSize }) {
  const limits = limitsOf(brief)
  const m = brief.margin
  // A third of the row: the figure alone ("81h"), the delay margin its own line.
  const narrow = (size?.cols ?? 3) < 2
  return (
    <>
      <WidgetLabel
        right={
          narrow ? (
            <Tally rows={limits} />
          ) : m ? (
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground" suppressHydrationWarning>
              Delay <span className={cn("tabular-nums", marginTone(m.minutes))}>{marginText(m.minutes)}</span>
            </span>
          ) : (
            <Tally rows={limits} />
          )
        }
      >
        Limits
      </WidgetLabel>
      {narrow && m && (
        <p className="-mt-0.5 mb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground" suppressHydrationWarning>
          Delay <span className={cn("tabular-nums", marginTone(m.minutes))}>{marginText(m.minutes)}</span>
        </p>
      )}
      <ul className="space-y-1.5">
        {limits.map((r) => {
          // What is LEFT is the question ("how much more"); the bar shows what is used.
          const left = (r.detail?.find((d) => d.label === "Remaining")?.value ?? "").replace(/h$/, "")
          const fraction = Math.min(1, Math.max(0, r.progress ?? 0))
          const fill = r.state === "ok" ? "bg-muted-foreground" : REQ_TONE[r.state].fill
          return (
            <li key={r.id} className="text-[11px] leading-none">
              <span className="flex items-baseline justify-between gap-1">
                <span className="truncate text-muted-foreground">{r.label}</span>
                <span className="shrink-0 tabular-nums">
                  <span className={cn("font-semibold", r.state === "ok" ? "text-foreground" : REQ_TONE[r.state].icon)}>{left}h</span>
                  {!narrow && <span className="text-muted-foreground"> left</span>}
                </span>
              </span>
              <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted">
                <span className={cn("block h-full rounded-full", fill)} style={{ width: `${fraction * 100}%` }} />
              </span>
            </li>
          )
        })}
      </ul>
    </>
  )
}
