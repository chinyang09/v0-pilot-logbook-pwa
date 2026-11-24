"use client"

/**
 * What each widget shows on the page — the glance. Everything here is ONE
 * line per fact, truncated rather than wrapped, so a tile is the same height
 * whatever it says (the page is laid out to a phone's height and must not
 * move as the answers land). The detail behind each is in `details.tsx`.
 */

import type { Requirement } from "@/lib/utils/dashboard/legality"
import type { SectorLeg } from "@/lib/utils/dashboard/duty-status"
import { formatDay } from "@/lib/utils/date"
import { cn } from "@/lib/utils"
import { dutyWindow, formatDutyClock } from "@/lib/utils/dashboard/duty-status"
import { REQ_TONE, TONE } from "./instruments"
import { DutyClockFace, DutyClockStrip, HourLines, dutyClockView } from "./duty-clock"
import { dutyClock, type DutyClock } from "@/lib/utils/dashboard/duty-clock"
import { WidgetLabel } from "./widget"
import { metarConditions } from "@/lib/weather/brief"
import { favouredRunway, runwayEndsFrom, type WindOnRunway } from "@/lib/weather/runway-wind"
import type { FlightBrief } from "./model"
import type { CrewMate } from "@/lib/utils/dashboard/flight-brief"
import { FACE_WIDE_COLS, type TileSize } from "@/lib/utils/dashboard/bento"
import { TileRows } from "./tile-rows"
import { PILOT_ROLES, roleLabel, type LogbookAuthority } from "@/lib/utils/logbook-rules"
import type { PilotRole } from "@/types/entities/flight.types"
import { addDays, localDayKey, lookAheadFor, type LookAhead } from "@/lib/utils/dashboard/currency-dots"
import { daysLeftAt } from "@/lib/utils/dashboard/currency-summary"
import { RECENCY_CAUTION_DAYS } from "@/lib/utils/dashboard/legality"
import { CurrencyDots } from "./currency-dots"
import { Pager, useRememberedPage } from "./pager"
import { onwardLines, whereaboutsLines } from "@/lib/lookup/aircraft-whereabouts"
import { MIN_TURN_MIN } from "@/lib/utils/dashboard/estimated-in"
import * as React from "react"
import { ChevronRight, Plane } from "lucide-react"
import { formatClockDisplay } from "@/lib/utils/time"
import { flightInstantMs } from "@/lib/airports/code-changes"

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
export function DutyFace({ brief, inCard = false }: { brief: FlightBrief; inCard?: boolean }) {
  return (
    <>
      <div
        aria-hidden
        className={cn("pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b to-transparent", TONE[brief.status.dutyState].glow)}
      />
      <div className="relative">
        <DutyClockFace brief={brief} inCard={inCard} />
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


/**
 * The duty laid on its day (the owner's duty-and-crew widget): a 24-hour
 * strip in the pilot's clock — a tick each hour, a taller one every six with
 * its hour under it — the duty from report to off duty as a track, each leg
 * filled on it (flown in ink, still to fly in the accent) and now as a
 * hairline. The track and the legs are squared off (the owner: so their left
 * and right ends read), and a duty past midnight moves the window on so it is
 * all in view.
 */
function DayBar({ brief, focus }: { brief: FlightBrief; focus: number | null }) {
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
    // No inset for the first hour, centred on the left edge: it hangs into the
    // tile's padding. An inset in px would scale with the stretched copy in
    // the morph and part the tile's labels from the card's.
    <div aria-hidden className="mb-1.5" data-morph="fl-day" data-morph-stretch>
      <div className="relative h-6">
        {/* A line each hour, all one height, every sixth bold — the duty strip's. */}
        <HourLines ticks={Array.from({ length: 25 }, (_, h) => ({ ms: from + h * H, major: h % 6 === 0 }))} pct={pct} />
        <div className="absolute inset-x-0 top-0 h-[18px]">
          <span className="absolute inset-y-0 rounded-[3px] border border-foreground/30 bg-muted" style={span(start0, end0)} />
          {legs.map((t, i) =>
            t.departMs !== null && t.arriveMs !== null ? (
              <span
                key={i}
                className={cn(
                  "absolute inset-y-[3px] rounded-[2px] transition-opacity",
                  duty.legs[i]?.inTime ? "bg-foreground/55" : "bg-primary",
                  // The leg the page is about stands out; the others are context.
                  focus !== null && focus !== i && "opacity-35",
                )}
                style={span(t.departMs, t.arriveMs)}
              />
            ) : null,
          )}
          {now > from && now < to && <span className="absolute -inset-y-0.5 w-0.5 rounded-full bg-foreground" style={{ left: pct(now) }} />}
        </div>
      </div>
      <div className="relative mt-0.5 h-3 text-[9px] tabular-nums text-muted-foreground">
        {[0, 6, 12, 18].map((h) => (
          // Centred on its tick, as the duty strip's hours are.
          <span key={h} data-anchor="center" className="absolute -translate-x-1/2" style={{ left: pct(from + h * H) }}>
            {String(hourOf(from + h * H)).padStart(2, "0")}
          </span>
        ))}
        <span data-anchor="end" className="absolute right-0">{zulu ? "Z" : "L"}</span>
      </div>
    </div>
  )
}

/** A crew member's seat as the pilot's logbook rules name it ("PIC", "P2"); a relief pilot is "Relief". */
export function crewRole(role: string, authority: LogbookAuthority): string {
  if ((PILOT_ROLES as readonly string[]).includes(role)) return roleLabel(role as PilotRole, authority)
  return /relief/i.test(role) ? "Relief" : role
}

/** The key a crew member's initials and name fly between the tile and the card under. */
export const crewKey = (m: { personId?: string | null; name: string }) => (m.personId ?? m.name).replace(/\s+/g, "_")

/** "Woon Kok Heng" → "WK". */
export function initialsOf(name: string): string {
  const parts = shortName(name).split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?"
}

/** The leg the duty is on now: the first not yet on blocks, else the last. */
export function legNow(brief: FlightBrief): number {
  const i = brief.duty.legs.findIndex((l) => !l.inTime)
  return i < 0 ? Math.max(0, brief.duty.legs.length - 1) : i
}

/**
 * The line under a leg's aeroplane (the owner, Nov 2026): on the leg the
 * pilot takes the aeroplane over for, when its inbound LANDED — whether to
 * hold the APU after start; on the duty's last leg, the flight that takes
 * the aeroplane over after it and when that crew reports at the aircraft
 * (its STD less an hour) — whether to secure it, and to init the MCDU for
 * them. Nothing else: not the rest before the duty (the duty card's), not
 * the leg after (the pilot flies it).
 */
export function legLine(brief: FlightBrief, i: number): { kind: "inbound" | "onward"; text: string; late?: boolean } | null {
  const { duty } = brief
  const f = duty.legs[i]
  if (!f) return null
  const sep = brief.display?.clockSeparator
  if (i === legNow(brief) && !f.inTime && !f.outTime) {
    const inbound = duty.lookups?.inbound
    const w = inbound?.status === "done" ? whereaboutsLines(inbound.whereabouts, brief.now, sep) : null
    // The flight number only — where it came from is the card's; the time it
    // landed is what decides the engines' idle and the APU on the turn.
    if (w) return { kind: "inbound", text: [w.flight.split(" ")[0], w.primary].filter(Boolean).join(" · "), late: inboundLate(brief, i) }
  }
  if (i === duty.legs.length - 1) {
    const onward = duty.lookups?.onward
    const o = onward?.status === "done" ? onwardLines(onward.whereabouts, sep) : null
    if (o) return { kind: "onward", text: ["Next " + o.flight.split(" ")[0], o.crew].filter(Boolean).join(" · ") }
    const g = duty.lookups?.gates[f.id]
    const viaAirport = g?.status === "done" ? g.gates.onwardFlight : ""
    if (viaAirport) return { kind: "onward", text: `Next ${viaAirport}` }
  }
  return null
}

/**
 * The inbound aeroplane lands too late for leg `i` to leave on time: its
 * arrival plus a turnaround (`MIN_TURN_MIN`) past the leg's scheduled OUT —
 * the line under the leg turns amber (the owner, Nov 2026: react to
 * real-time changes, grab attention only where it belongs).
 */
export function inboundLate(brief: FlightBrief, i: number): boolean {
  const f = brief.duty.legs[i]
  const w = brief.duty.lookups?.inbound
  if (!f || f.outTime || w?.status !== "done" || brief.duty.lookups?.inboundFlightId !== f.id) return false
  const arrival = w.whereabouts.inbound?.arrival ? Date.parse(w.whereabouts.inbound.arrival) : NaN
  const out = f.scheduledOut && /^\d{1,2}:\d{2}$/.test(f.scheduledOut) ? Date.parse(`${f.date}T${f.scheduledOut.padStart(5, "0")}:00Z`) : NaN
  return Number.isFinite(arrival) && Number.isFinite(out) && arrival + MIN_TURN_MIN * 60_000 > out
}

/**
 * How late leg `i` is now expected to leave, in minutes — from the sources'
 * estimate, the inbound's arrival or the leg before (`estimateDutyIn`) — or
 * null when it is on schedule, has left, or nothing live is known.
 */
export function legDelay(brief: FlightBrief, i: number): number | null {
  const f = brief.duty.legs[i]
  const e = brief.duty.estimate?.legs[i]
  if (!f || !e || f.outTime || e.outKind === "scheduled" || e.outMs === null) return null
  const sched = f.scheduledOut && /^\d{1,2}:\d{2}$/.test(f.scheduledOut) ? Date.parse(`${f.date}T${f.scheduledOut.padStart(5, "0")}:00Z`) : NaN
  if (!Number.isFinite(sched)) return null
  const late = Math.round((e.outMs - sched) / 60_000)
  return late >= DELAY_SAID_MIN ? late : null
}

/** A delay under this is not said — a few minutes either way is the schedule. */
const DELAY_SAID_MIN = 10

/** "OUT +0:40" in amber, beside a leg's times — the departure, said as such (the times beside it are the schedule). */
function DelayChip({ minutes }: { minutes: number | null }) {
  if (minutes === null) return null
  return <span className="shrink-0 whitespace-pre font-semibold text-status-warning"> · OUT +{formatDutyClock(minutes)}</span>
}

/** A terminal worth naming: "T1" → "1"; a blank or a source's "0" → "". */
export function knownTerminal(t: string | undefined | null): string {
  const v = (t ?? "").trim().replace(/^T/i, "")
  return v && v !== "0" ? v : ""
}

/**
 * Leg `i`'s aeroplane: its own (the logbook's, the inbound's on the leg the
 * pilot takes over, the source's), else — a turnaround, leaving where the leg
 * before arrived — the leg before's, marked EXPECTED (the owner, Nov 2026:
 * "Aircraft TBA" beside a known tail read as missing data).
 */
export function legAircraft(brief: FlightBrief, i: number): { reg: string; type: string; expected: boolean; from: string } {
  const { duty } = brief
  const f = duty.legs[i]
  if (!f) return { reg: "", type: "", expected: false, from: "" }
  const g = duty.lookups?.gates[f.id]
  const own = f.aircraftReg || (i === legNow(brief) ? duty.lookups?.inboundRegistration : "") || (g?.status === "done" ? g.gates.flight.registration : "") || ""
  if (own) return { reg: own, type: f.aircraftType || "", expected: false, from: "" }
  const prev = duty.legs[i - 1]
  if (prev && prev.arrivalIcao && prev.arrivalIcao === f.departureIcao) {
    const p = legAircraft(brief, i - 1)
    if (p.reg) return { reg: p.reg, type: f.aircraftType || p.type, expected: true, from: prev.flightNumber || "" }
  }
  return { reg: "", type: f.aircraftType || "", expected: false, from: "" }
}

/** Why the flights tile's edge is amber, per leg: it leaves late, or its inbound lands too late to turn round. */
export function legLate(brief: FlightBrief, i: number): boolean {
  return legDelay(brief, i) !== null || inboundLate(brief, i)
}

/**
 * One leg as the flights tile has it (the owner, Nov 2026: "show aircraft in
 * use, gate, essentially flight info"): the route large; the flight number
 * and its times; the AEROPLANE (registration and type) and the GATE on a line
 * of their own; then the inbound's landing, or the flight after ours.
 */
function LegPage({ brief, i, more = false }: { brief: FlightBrief; i: number; more?: boolean }) {
  const { duty, clock, code } = brief
  const f = duty.legs[i]
  const t = duty.times[i]
  const flown = !!f.inTime
  const gates = duty.info?.legGates[i]
  const gate = flown ? gates?.arr || "" : gates?.dep || ""
  const { reg, type, expected } = legAircraft(brief, i)
  const line = legLine(brief, i)
  return (
    <>
      <p className="truncate text-[17px] font-bold leading-tight tracking-tight text-foreground @[15rem]:text-[21px]" data-morph={`fl-route-${i}`}>
        {code(f.departureIcao, f.departureIata)} – {code(f.arrivalIcao, f.arrivalIata)}
      </p>
      {/* The delay keeps its place when the line is short of room: the times give way first. */}
      <p className="mt-0.5 flex min-w-0 items-baseline text-[12px] leading-tight tabular-nums text-foreground">
        <span className="min-w-0 truncate" suppressHydrationWarning data-morph={`fl-num-${i}`}>
          <span className="font-semibold">{f.flightNumber || "Flight"}</span>
          {t?.departMs != null && t?.arriveMs != null && ` · ${clock(t.departMs).replace(/Z$/, "")}–${clock(t.arriveMs)}`}
          {flown && <span className="text-muted-foreground"> · On blocks</span>}
        </span>
        <DelayChip minutes={legDelay(brief, i)} />
      </p>
      <p className="flex items-baseline justify-between gap-2 text-[12px] leading-tight tabular-nums">
        <span className="min-w-0 truncate" data-morph={`fl-ac-${i}`}>
          <span className={cn("font-semibold", reg ? "text-foreground" : "text-muted-foreground")}>{reg || "Aircraft TBA"}</span>
          {reg && type && <span className="text-muted-foreground"> {type}</span>}
          {expected && <span className="text-muted-foreground"> · expected</span>}
        </span>
        {gate && (
          <span className="shrink-0 font-semibold text-foreground" data-morph={`fl-gate-${i}`}>
            {flown ? "Arr " : ""}Gate {gate}
          </span>
        )}
      </p>
      <p
        className={cn("truncate text-[11px] leading-tight", line?.late ? "font-semibold text-status-warning" : "text-muted-foreground")}
        suppressHydrationWarning
        data-morph={`fl-next-${i}`}
      >
        {line?.text || "\u00a0"}
      </p>
      {/* A tall wide tile: the leg's own rows the face has not said. */}
      {more && (
        <TileRows
          rows={legRows(brief, i)
            .filter((r) => !r.morph)
            .map((r) => ({ key: r.label, label: r.label, value: r.value, sub: r.sub, tone: r.tone }))}
        />
      )}
    </>
  )
}

/** How much of a long rest the flights tile draws before the report: the duty is what it is about. */
const REST_TILE_H = 3

/**
 * The duty's TIMELINE as the flights tile and its card draw it (the owner,
 * Nov 2026: one timeline for the legs and the FDP): the duty strip
 * (`dutyClock`) with the rest before it cut to its last few hours — a
 * shortfall still red — so the report, the legs and the maximum's cap have
 * the width. Null where the duty clock has nothing to draw.
 */
export function flightClock(brief: FlightBrief): DutyClock | null {
  const view = dutyClockView(brief)
  if (!view || !view.input.duty) return null
  const { rest, duty } = view.input
  const trimmed = rest ? { ...rest, startMs: Math.max(rest.startMs, duty.reportMs - REST_TILE_H * 3_600_000) } : null
  return dutyClock({ ...view.input, rest: trimmed && trimmed.startMs < duty.reportMs ? trimmed : null })
}

/** The duty's timeline (`flightClock`), else the 24-hour day bar. */
function DutyTimeline({ brief, focus }: { brief: FlightBrief; focus: number | null }) {
  const c = flightClock(brief)
  if (!c) return <DayBar brief={brief} focus={focus} />
  return (
    <div className="-mt-1 mb-1.5">
      <DutyClockStrip clock={c} zulu={brief.display?.useZuluTime !== false} focus={focus} />
    </div>
  )
}

/** A duty figure's caption as the readout has room for it: "Min 10:00 + night" is the rest's, "Report 18 Nov" the report's. */
export function readoutLabel(label: string): string {
  if (/^min\b/i.test(label)) return "Rest"
  if (/^report\b/i.test(label)) return "Report"
  if (/^from\b/i.test(label)) return "From"
  return label.replace(/\s*\/\s*/g, "/")
}

/**
 * The FDP beside the leg (the owner, Nov 2026: where "No crew yet" was) —
 * the duty's line in its tone ("Sector 1 of 2", "Legal from 22:00Z", "Rest
 * short by 3:00"), then the duty clock's three figures a row each (FDP left ·
 * FDP / max · latest IN on duty; rest · report · FDP / max before it), and
 * the leg's flight crew as initials at its foot. The figures fly into the
 * card's Duty & FDP rows (`slot-<n>-v`).
 */
function DutyReadout({ brief, crew, wide = false, extra }: { brief: FlightBrief; crew: CrewMate[]; wide?: boolean; extra?: React.ReactNode }) {
  const view = dutyClockView(brief)
  const flightCrew = crew.filter((m) => !m.cabin)
  if (!view && flightCrew.length === 0) return null
  const lit = !view
    ? ""
    : view.stateTone === "action_required"
      ? "text-destructive"
      : view.stateTone === "warning"
        ? "text-status-warning"
        : "text-foreground"
  const shown = flightCrew.slice(0, 3)
  return (
    <div className={cn("flex shrink-0 flex-col gap-1 border-l border-border/60 pl-2.5", wide ? "w-44" : "w-[40%] max-w-44")}>
      {view && (
        <>
          <p className={cn("truncate text-[12px] font-semibold leading-tight", lit)} suppressHydrationWarning data-morph="duty-headline">
            {view.headline}
          </p>
          {view.slots.map((slot, i) => (
            <p key={slot.label} className="flex min-w-0 items-baseline justify-between gap-1.5 leading-tight">
              <span className="min-w-0 truncate text-[9px] font-medium uppercase tracking-wider text-muted-foreground">{readoutLabel(slot.label)}</span>
              <span
                className={cn(
                  "shrink-0 text-[13px] font-semibold tabular-nums",
                  slot.tone === "fail" ? "text-destructive" : slot.tone === "caution" ? "text-status-warning" : "text-foreground",
                )}
                suppressHydrationWarning={slot.live}
                data-morph={`slot-${i}-v`}
              >
                {slot.value}
              </span>
            </p>
          ))}
        </>
      )}
      {/* A tall wide tile: the rest of the duty's table (the card's). */}
      {extra}
      {/* The leg's flight crew, by initials: the card names them. */}
      {shown.length > 0 && (
        <span className="mt-auto flex items-center gap-1 pt-0.5" aria-label={shown.map((m) => shortName(m.name)).join(", ")}>
          {shown.map((m) => (
            <span
              key={m.personId ?? m.name}
              title={shortName(m.name)}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[8px] font-semibold text-foreground"
              data-morph={`crew-ini-${crewKey(m)}`}
            >
              {initialsOf(m.name)}
            </span>
          ))}
          {flightCrew.length > shown.length && <span className="text-[10px] text-muted-foreground">+{flightCrew.length - shown.length}</span>}
        </span>
      )}
    </div>
  )
}

/**
 * FLIGHT & DUTY — today's tactical tile (the owner, Nov 2026: the flights and
 * the duty "operate on the exact same tactical time horizon"; one timeline,
 * not two). Its eyebrow (Now / Next / Later · the day, "Leg 1/2"), the duty's
 * timeline — the report, the legs (the one on show lit) and the Reg 14
 * maximum's cap — then a leg a page on the left (route, number and times,
 * aeroplane and gate, the inbound or the flight after) and the FDP on the
 * right (`DutyReadout`). A standby, or no duty with flights, is the duty
 * clock's own face.
 */
export function FlightFace({
  brief,
  size,
  inCard = false,
  fill = false,
  dutyMore,
}: {
  brief: FlightBrief
  size: TileSize
  inCard?: boolean
  fill?: boolean
  /** Under the FDP on a tall wide tile: the rest of the duty's table. */
  dutyMore?: React.ReactNode
}) {
  const { duty, day } = brief
  const count = duty.legs.length
  const [page, setPage] = useRememberedPage(`flight:${duty.atMs}`, legNow(brief), count)
  if (duty.atMs === null || duty.standby) return <DutyFace brief={brief} inCard={inCard} />
  // A WIDE tile (a desktop's full width) lays its legs side by side — each
  // about a phone third and a half — beside the FDP.
  const wide = !inCard && size.cols >= FACE_WIDE_COLS
  const room = size.cols - 1.45
  const per = wide ? Math.max(1, Math.min(count, Math.floor(room / LEG_COLS))) : 1
  // The crew of the leg on show — of the first leg on show, side by side.
  const first = per > 1 ? Math.floor(page / per) * per : page
  const crew = count ? (brief.legCrew[first] ?? brief.crew) : brief.crew
  const { legs, route } = chainOf(brief)
  const stops = legs.length ? [legs[0].from, ...legs.map((l) => l.to)] : (route ?? "").split("-").filter(Boolean)
  const shownTo = Math.min(count, first + per)
  const legLabel = per > 1 ? (count > per ? `Legs ${first + 1}–${shownTo}/${count}` : null) : `Leg ${page + 1}/${count}`
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <WidgetLabel right={count > 1 && legLabel ? <span className="text-[10px] font-semibold tabular-nums text-muted-foreground" data-morph="fl-legn">{legLabel}</span> : undefined}>
        <span suppressHydrationWarning>
          {dutyWord(brief)} · {day(duty.atMs)}
        </span>
      </WidgetLabel>
      <DutyTimeline brief={brief} focus={count > 1 && per === 1 ? page : null} />
      <div className="flex min-h-0 min-w-0 flex-1 gap-3">
        {/* A container: beside the FDP the leg has ~200px of a phone, and a
            three-stop route at 21px does not fit it (measured at 360). */}
        <div className="@container flex min-w-0 flex-1 flex-col">
          {count === 0 ? (
            <p className="truncate text-[17px] font-bold leading-tight tracking-tight text-foreground @[15rem]:text-[21px]" data-morph="fl-route">
              {stops.join(stops.length > 2 ? "–" : " – ") || "—"}
            </p>
          ) : (
            <Pager count={count} page={page} onPage={setPage} morph="fl" perPage={per} fill={fill} dotTone={(i) => (legLate(brief, i) ? "caution" : undefined)}>
              {(i) => <LegPage brief={brief} i={i} more={fill} />}
            </Pager>
          )}
        </div>
        {!inCard && <DutyReadout brief={brief} crew={crew} wide={wide} extra={fill ? dutyMore : undefined} />}
      </div>
    </div>
  )
}

/** The width one leg takes side by side on a wide tile, in thirds of a phone's row. */
const LEG_COLS = 1.5

/** A row of a card's table: what it is on the left, the value on the right. */
export interface CardRow {
  label: string
  value: React.ReactNode
  sub?: string
  tone?: "caution" | "fail"
  /** The tile's element this value is — it flies there from the face. */
  morph?: string
}

/** The rows as a two-column table — the duty card's shape, shared. */
export function CardTable({ rows }: { rows: CardRow[] }) {
  if (rows.length === 0) return null
  return (
    <dl>
      {rows.map((r, i) => (
        <div key={r.label} className={cn("flex items-baseline justify-between gap-4 py-2", i < rows.length - 1 && "border-b border-border/50")}>
          <dt className="shrink-0 text-[13px] text-muted-foreground">{r.label}</dt>
          <dd className="min-w-0 text-right">
            <span
              className={cn(
                "text-[15px] font-semibold tabular-nums",
                r.tone === "fail" ? "text-destructive" : r.tone === "caution" ? "text-status-warning" : "text-foreground",
              )}
              suppressHydrationWarning
              data-morph={r.morph}
            >
              {r.value}
            </span>
            {r.sub && <span className="block text-[11px] text-muted-foreground" suppressHydrationWarning>{r.sub}</span>}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** "00:05" − "22:30" across midnight → "1:35"; "" without both. */
export function plannedBlock(out?: string, inn?: string): string {
  if (!out || !inn) return ""
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  if (!/^\d\d:\d\d$/.test(out) || !/^\d\d:\d\d$/.test(inn)) return ""
  const d = (m(inn) - m(out) + 1440) % 1440
  return d ? `${Math.floor(d / 60)}:${String(d % 60).padStart(2, "0")}` : ""
}

/**
 * Leg `i` in the flights CARD, in the order it runs (the owner, Nov 2026:
 * "a revamp on the contents between the timeline and crew. No repetition.
 * Content from widget move to position"): the route and number as the tile
 * has them, then a table — the inbound aeroplane, our aeroplane, the
 * departure gate, the OUT and IN where they are not the schedule (actual, or
 * the live estimate), the arrival gate, the block, the flight after ours —
 * each of the tile's lines flying into its row. Nothing the number line says
 * is said again.
 */
/**
 * Leg `i`'s rows, in the order it runs — the flights card's table, and what a
 * TALL wide tile lists under the leg (`TileRows`) once the face's own lines
 * (the rows tagged `morph`) are left out.
 */
export function legRows(brief: FlightBrief, i: number, omitEstIn = false): CardRow[] {
  const { duty, clock } = brief
  const f = duty.legs[i]
  const t = duty.times[i]
  const sep = brief.display?.clockSeparator
  const flown = !!f.inTime
  const g = duty.lookups?.gates[f.id]
  const gates = g?.status === "done" ? g.gates : null
  const line = legLine(brief, i)
  const ac = legAircraft(brief, i)
  const e = duty.estimate?.legs[i]
  const rows: CardRow[] = []
  // The aeroplane coming in, on the leg the pilot takes it over for.
  const inbound = duty.lookups?.inbound
  const w = line?.kind === "inbound" && inbound?.status === "done" ? whereaboutsLines(inbound.whereabouts, brief.now, sep) : null
  if (line?.kind === "inbound") {
    rows.push({
      label: "Inbound",
      value: line.text,
      sub: [w?.flight.split(" ").slice(1).join(" "), w?.std, w?.gate && `Arr ${w.gate}`].filter(Boolean).join(" · ") || undefined,
      tone: line.late ? "caution" : undefined,
      morph: `fl-next-${i}`,
    })
  } else if (gates?.inboundFlight && !flown && !f.outTime) {
    rows.push({ label: "Inbound", value: gates.inboundFlight })
  }
  rows.push({
    label: "Aircraft",
    value: ac.reg ? `${ac.reg}${ac.type ? ` ${ac.type}` : ""}` : "TBA",
    sub: ac.expected ? `Expected · after ${ac.from || "the leg before"}, not yet confirmed` : undefined,
    morph: `fl-ac-${i}`,
  })
  // A contact stand named like its gate is the gate said twice.
  const terminalStand = (x: { gate: string; terminal: string; stand?: string } | undefined) =>
    // A terminal of "0" is no terminal (a source's blank), never "Terminal 0".
    [knownTerminal(x?.terminal) && `Terminal ${knownTerminal(x?.terminal)}`, x?.stand && x.stand !== x.gate && `Stand ${x.stand}`].filter(Boolean).join(" · ") || undefined
  if (gates?.departure.gate || gates?.departure.stand) {
    rows.push({
      label: "Departure",
      value: gates.departure.gate ? `Gate ${gates.departure.gate}` : `Stand ${gates.departure.stand}`,
      sub: gates.departure.gate ? terminalStand(gates.departure) : undefined,
      morph: flown ? undefined : `fl-gate-${i}`,
    })
  }
  // The times where they are NOT what the number line says: what flew
  // against the schedule, or the live estimate against it.
  const sched = (hhmm?: string) => (hhmm && /^\d{1,2}:\d{2}$/.test(hhmm) ? `${formatClockDisplay(hhmm, sep)}Z` : "")
  // Against the schedule, one way everywhere: "+0:33", "−0:05", "On time".
  const minutesOff = (ms: number | null, hhmm: string | undefined, after?: string) => {
    const s0 = hhmm && /^\d{1,2}:\d{2}$/.test(hhmm) ? flightInstantMs(f.date, hhmm, after ?? null) : null
    return ms === null || s0 === null ? null : Math.round((ms - s0) / 60_000)
  }
  const versus = (ms: number | null, hhmm: string | undefined, after?: string) => {
    const d = minutesOff(ms, hhmm, after)
    if (d === null) return ""
    return Math.abs(d) < 5 ? "On time" : d > 0 ? `+${formatDutyClock(d)}` : `−${formatDutyClock(-d)}`
  }
  // Amber only for its OWN lateness (a delay said from 10 minutes).
  const lateTone = (ms: number | null, hhmm: string | undefined, after?: string) => {
    const d = minutesOff(ms, hhmm, after)
    return d !== null && d >= DELAY_SAID_MIN ? ("caution" as const) : undefined
  }
  if (f.outTime) {
    // The number line says what flew; the schedule it flew against, once.
    const range = sched(f.scheduledOut) && sched(f.scheduledIn) ? `${sched(f.scheduledOut).replace(/Z$/, "")}–${sched(f.scheduledIn)}` : ""
    const sub = [
      versus(t?.departMs ?? null, f.scheduledOut) && `OUT ${versus(t?.departMs ?? null, f.scheduledOut)}`,
      f.inTime && versus(t?.arriveMs ?? null, f.scheduledIn, f.scheduledOut) && `IN ${versus(t?.arriveMs ?? null, f.scheduledIn, f.scheduledOut)}`,
    ].filter(Boolean).join(" · ")
    if (range) rows.push({ label: "Scheduled", value: range, sub: sub || undefined })
    // Off blocks, not yet on: where it is now expected in.
    if (!f.inTime && e && e.inMs !== null && !omitEstIn)
      rows.push({ label: "Est. IN", value: clock(e.inMs), sub: versus(e.inMs, f.scheduledIn, f.scheduledOut) || undefined, tone: lateTone(e.inMs, f.scheduledIn, f.scheduledOut) })
  } else if (e && (e.outKind !== "scheduled" || e.inKind !== "scheduled")) {
    // Not yet off: the number line is the schedule; the live estimate against it
    // (a source may give the arrival and not the departure).
    if (e.outKind !== "scheduled" && e.outMs !== null)
      rows.push({ label: "Est. OUT", value: clock(e.outMs), sub: versus(e.outMs, f.scheduledOut) || undefined, tone: lateTone(e.outMs, f.scheduledOut) })
    if (e.inMs !== null && !omitEstIn)
      rows.push({ label: "Est. IN", value: clock(e.inMs), sub: versus(e.inMs, f.scheduledIn, f.scheduledOut) || undefined, tone: lateTone(e.inMs, f.scheduledIn, f.scheduledOut) })
  }
  if (gates?.arrival.gate || gates?.arrival.stand) {
    rows.push({
      label: "Arrival",
      value: gates.arrival.gate ? `Gate ${gates.arrival.gate}` : `Stand ${gates.arrival.stand}`,
      sub: gates.arrival.gate ? terminalStand(gates.arrival) : undefined,
      morph: flown ? `fl-gate-${i}` : undefined,
    })
  }
  const block = flown && f.blockTime && f.blockTime !== "00:00" ? f.blockTime : plannedBlock(f.scheduledOut, f.scheduledIn)
  if (block) rows.push({ label: flown ? "Block" : "Planned Block", value: block })
  // The flight that takes the aeroplane over after ours.
  if (line?.kind === "onward") {
    const onward = duty.lookups?.onward
    const o = onward?.status === "done" ? onwardLines(onward.whereabouts, sep) : null
    rows.push({
      label: "Next Flight",
      value: line.text.replace(/^Next /, ""),
      sub: [o?.flight.split(" ").slice(1).join(" "), o?.std].filter(Boolean).join(" · ") || undefined,
      morph: `fl-next-${i}`,
    })
  }
  return rows
}

function CardLeg({ brief, i }: { brief: FlightBrief; i: number }) {
  const { duty, clock, code } = brief
  const f = duty.legs[i]
  const t = duty.times[i]
  const flown = !!f.inTime
  // The duty's last IN, estimated, is the Duty & FDP table's (with how far it
  // is from the latest IN) — not said twice on the last leg.
  const rows = legRows(brief, i, i === duty.legs.length - 1 && !!duty.estimate)
  return (
    <>
      <p className="truncate text-[21px] font-bold leading-tight tracking-tight text-foreground" data-morph={`fl-route-${i}`}>
        {code(f.departureIcao, f.departureIata)} – {code(f.arrivalIcao, f.arrivalIata)}
      </p>
      <p className="mt-0.5 truncate text-[12px] leading-tight tabular-nums text-foreground" suppressHydrationWarning data-morph={`fl-num-${i}`}>
        <span className="font-semibold">{f.flightNumber || "Flight"}</span>
        {t?.departMs != null && t?.arriveMs != null && ` · ${clock(t.departMs).replace(/Z$/, "")}–${clock(t.arriveMs)}`}
        {flown && <span className="text-muted-foreground"> · On blocks</span>}
      </p>
      <div className="mt-1.5">
        <CardTable rows={rows} />
      </div>
    </>
  )
}

/** An ACTION, not a row of the table (the owner: it read as another field): a capsule on the control surface. */
function OpenFlight({ brief, i, openFlight }: { brief: FlightBrief; i: number; openFlight: (id: string) => void }) {
  const f = brief.duty.legs[i]
  if (!f) return null
  return (
    <button
      type="button"
      onClick={() => openFlight(f.id)}
      className="control-surface mt-2.5 flex h-10 w-full items-center justify-center gap-2 rounded-full px-4 text-[14px] font-medium text-foreground transition-colors"
    >
      <Plane className="h-4 w-4 shrink-0" aria-hidden />
      <span className="truncate">Open {f.flightNumber || "Flight"}</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  )
}

/**
 * The flight & duty CARD above its crew: the duty on its day and its
 * timeline, then a leg a page — swiped as the tile is — and under the pages,
 * not swiped, the duty's own table (`duty`, the Duty & FDP rows) and the leg
 * on show's Open, the dots under it (the owner).
 */
export function FlightCardLegs({ brief, openFlight, duty: dutyNode }: { brief: FlightBrief; openFlight: (id: string) => void; duty?: React.ReactNode }) {
  const { duty, day } = brief
  const count = duty.legs.length
  const [page, setPage] = useRememberedPage(`flight:${duty.atMs}`, legNow(brief), count)
  if (duty.atMs === null) return <p className="py-1 text-[13px] text-muted-foreground">Nothing rostered</p>
  const below = (
    <>
      {dutyNode}
      {count > 0 && <OpenFlight brief={brief} i={page} openFlight={openFlight} />}
    </>
  )
  return (
    <div>
      <WidgetLabel right={count > 1 ? <span className="text-[10px] font-semibold tabular-nums text-muted-foreground" data-morph="fl-legn">Leg {page + 1}/{count}</span> : undefined}>
        <span suppressHydrationWarning>
          {dutyWord(brief)} · {day(duty.atMs)}
        </span>
      </WidgetLabel>
      <DutyTimeline brief={brief} focus={count > 1 ? page : null} />
      {count === 0 ? (
        <>
          <p className="truncate text-[21px] font-bold leading-tight tracking-tight text-foreground" data-morph="fl-route">
            {(chainOf(brief).route ?? "").split("-").filter(Boolean).join(" – ") || "—"}
          </p>
          {below}
        </>
      ) : (
        <Pager count={count} page={page} onPage={setPage} morph="fl" dotTone={(i) => (legLate(brief, i) ? "caution" : undefined)} below={below}>
          {(i) => <CardLeg brief={brief} i={i} />}
        </Pager>
      )}
    </div>
  )
}

/* ── Destinations ────────────────────────────────────────────────────────── */

/**
 * Every airport the duty lands at, in the order it reaches them — the return
 * to base included. Leaving it out (it is where the duty starts) gave a
 * there-and-back duty ONE destination: no dots and nothing to swipe (the
 * owner's report), and no runway or weather card for the landing home.
 */
export function destinationsOf(brief: FlightBrief) {
  return brief.destinations
}

/** The runway the wind favours at a destination — the tile's tone (a tailwind) reads it. */
export function favouredAt(brief: FlightBrief, icao: string): WindOnRunway | null {
  const info = brief.airportInfo[icao]
  const raw = brief.weather.briefs.find((b) => b.station === icao)?.metar?.raw
  if (!info || !raw) return null
  const c = metarConditions(raw)
  return favouredRunway(runwayEndsFrom(info.runways), c.windDir ?? null, c.windKt)
}

/* ── Currency and limits ─────────────────────────────────────────────────── */

/**
 * What is flagged past the rows a tile names, as a word in the colour of the
 * worst of it: "+2" — no icon (the owner, Nov 2026: "no need for alert icon …
 * just highlight area of concern with color change"). Nothing when nothing is.
 */
function MoreFlagged({ rows }: { rows: Array<{ state: Requirement["state"] }> }) {
  const flagged = rows.filter((r) => r.state !== "ok")
  if (flagged.length === 0) return null
  const fail = flagged.some((r) => r.state === "fail")
  return (
    <span
      className={cn("shrink-0 text-[10px] font-semibold tabular-nums", fail ? "text-destructive" : "text-status-warning")}
      aria-label={`${flagged.length} more flagged`}
    >
      +{flagged.length}
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
  // Forecast to a later duty: the days recency has left ON that day. Flights
  // rostered before it are not counted — they are not flown yet.
  const forecast = brief.currencyAsOfMs !== brief.now
  const lastDay = brief.recencyLapseIso ? addDays(brief.recencyLapseIso, -1) : null
  const daysAt = forecast && lastDay ? daysLeftAt(lastDay, brief.currencyAsOfMs) : null
  const logbook = brief.status.legality.requirements
    .filter((r) => r.group === "currency" && !r.id.startsWith("doc-"))
    .map((r) => {
      const beforeDuty =
        r.id === "recency" && r.state !== "fail" && brief.duty.atMs !== null && Number.isFinite(lapseMs) && lapseMs <= brief.duty.atMs
      const ahead = r.id === "recency" && r.state !== "fail" ? daysAt : null
      const state: Requirement["state"] =
        beforeDuty || (ahead !== null && ahead <= RECENCY_CAUTION_DAYS) ? "caution" : ahead !== null ? "ok" : r.state
      const value = ahead === null ? r.value : ahead < 0 ? "Lapsed" : `${ahead}d`
      return {
        key: r.id,
        name: r.id === "recency" ? "Recency 90d" : r.label,
        state,
        figure: beforeDuty ? `${value} · before duty` : value,
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
export function CurrencyFace({ brief, size, fill = false }: { brief: FlightBrief; size: TileSize; fill?: boolean }) {
  const all = currenciesBySoonest(currencyRows(brief))
  const ahead = lookAheadFor(size.cols)
  // Under two thirds of the row it names the closest only; a THIRD puts the
  // figure under the name (half the row has room for both on one line).
  const narrow = size.cols < 2
  const third = size.cols < 1.5
  // WIDE (a desktop's full width): the year of dots and the list side by
  // side, the list in the dots' height — more names, not bigger dots.
  const wide = size.cols >= FACE_WIDE_COLS
  // The rows sharing the page's height (the wide grid), the list is as long
  // as the tile holds — beside the dots when wide, under them when not.
  const fitList = fill || wide
  const lines = size.rows >= 2 ? (narrow ? 3 : 6) : narrow ? 1 : 2
  const marks = all.filter((r) => r.ymd !== null).map((r) => ({ key: r.key, name: r.name, state: r.state, ymd: r.ymd! }))
  return (
    <>
      {/* A third of the row has no room for the tally beside the label: its
          edge and the dots' colours carry what is flagged. */}
      {/* Wide, the list shows what its height holds, the flagged first: no tally. */}
      <WidgetLabel title right={third || fitList ? undefined : <MoreFlagged rows={all.slice(lines)} />}>
        Currency
        {/* Forecast to a later duty, the day it is judged on; else how far the dots look. */}
        {!third && (
          <span className="font-medium normal-case tracking-normal" suppressHydrationWarning>
            {" · "}
            {brief.currencyAsOfMs !== brief.now ? `at ${shortDay(localDayKey(brief.currencyAsOfMs))}` : AHEAD_SHORT[ahead]}
          </span>
        )}
      </WidgetLabel>
      {all.length === 0 ? (
        <p className="text-xs leading-snug text-muted-foreground">None tracked</p>
      ) : (
        fitList ? (
          // The year of dots and the list — beside them when wide, under
          // them when not — the list showing as many as the tile's height
          // holds (`TileRows`).
          <div className={cn("flex min-h-0 min-w-0 flex-1", wide ? "gap-4" : "flex-col")}>
            <div data-morph="cur-dots" className={cn("min-w-0", wide && "flex-[3]")}>
              <CurrencyDots today={localDayKey(brief.currencyAsOfMs)} ahead={ahead} marks={marks} closest={marks[0]?.key ?? null} />
            </div>
            <div className={cn("flex min-h-0 min-w-0 flex-col", wide ? "-mt-2 flex-[2]" : "flex-1")}>
              <TileRows
                names
                rows={all.map((r) => ({
                  key: r.key,
                  label: r.name,
                  value: r.figure.split(" · ")[0],
                  tone: r.state === "fail" ? "fail" : r.state === "ok" ? undefined : "caution",
                  labelMorph: `cur-name-${r.key}`,
                  valueMorph: `cur-fig-${r.key}`,
                }))}
              />
            </div>
          </div>
        ) : (
        <div>
          <div data-morph="cur-dots">
            <CurrencyDots today={localDayKey(brief.currencyAsOfMs)} ahead={ahead} marks={marks} closest={marks[0]?.key ?? null} className="mb-1" />
          </div>
          <ul className="space-y-1">
            {all.slice(0, lines).map((r) => {
              return (
                // No icon: a flagged currency says so in its figure's colour.
                <li key={r.key} className={cn("flex items-center gap-1 text-xs leading-tight", third && "flex-wrap")}>
                  <span className={cn("min-w-0 flex-1 truncate text-foreground", third && "basis-full")} data-morph={`cur-name-${r.key}`}>
                    {r.name}
                  </span>
                  <span
                    className={cn("shrink-0 font-semibold tabular-nums", r.state === "ok" ? "text-foreground" : REQ_TONE[r.state].icon)}
                    data-morph={`cur-fig-${r.key}`}
                  >
                    {r.figure.split(" · ")[0]}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
        )
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

/**
 * The four rolling limits as bars with the hours LEFT (the owner, Nov 2026:
 * the limits tile tracks the four limits; the FDP is the duty tile's) — the
 * TIGHTEST FIRST (the least headroom for its size leads; the owner: "show
 * whichever window has the lowest remaining buffer"), the basis beside the
 * label ("to 23 Nov": logged duties to the last one off), and in plain words
 * where one is near or at its limit.
 */
export function LimitsFace({ brief, size, fill = false }: { brief: FlightBrief; size?: TileSize; fill?: boolean }) {
  const limits = [...limitsOf(brief)].sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0))
  // A third of the row: the figure alone ("81h").
  const narrow = (size?.cols ?? 3) < 2
  // WIDE: two columns, each with what is used against its limit.
  const wide = (size?.cols ?? 3) >= FACE_WIDE_COLS
  const last = brief.status.duty.lastDuty?.debriefMs ?? null
  return (
    <>
      <WidgetLabel title>
        Limits
        {!narrow && last !== null && (
          <span className="font-medium normal-case tracking-normal" suppressHydrationWarning>
            {" · to "}
            {shortDay(new Date(last).toISOString().slice(0, 10))}
          </span>
        )}
      </WidgetLabel>
      {/* The rows share the tile's height, so a tall tile has no empty foot. */}
      {/* Filling the page's height, the rows under it take the room (`TileRows`). */}
      <ul className={cn(wide ? "grid grid-cols-2 gap-x-5 gap-y-2" : fill ? "flex flex-col gap-2" : "flex min-h-0 flex-1 flex-col justify-around gap-1.5")}>
        {limits.map((r) => {
          // What is LEFT is the question ("how much more"); the bar shows what is used.
          const left = (r.detail?.find((d) => d.label === "Remaining")?.value ?? "").replace(/h$/, "")
          const fraction = Math.min(1, Math.max(0, r.progress ?? 0))
          const fill = r.state === "ok" ? "bg-muted-foreground" : REQ_TONE[r.state].fill
          // Dark cockpit: "left" while there is room; plain words when there is not.
          const word = r.state === "fail" ? " at limit" : r.state === "caution" ? " near limit" : " left"
          return (
            <li key={r.id} className="text-[11px] leading-none">
              <span className="flex items-baseline justify-between gap-1">
                <span className="truncate text-muted-foreground" data-morph={`lim-name-${r.id}`}>
                  {r.label}
                </span>
                <span className="shrink-0 tabular-nums" data-morph={`lim-left-${r.id}`}>
                  <span className={cn("font-semibold", r.state === "ok" ? "text-foreground" : REQ_TONE[r.state].icon)}>{left}h</span>
                  {!narrow && <span className={r.state === "ok" ? "text-muted-foreground" : REQ_TONE[r.state].icon}>{word}</span>}
                  {wide && r.value && <span className="text-muted-foreground"> · {r.value}</span>}
                </span>
              </span>
              <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted" data-morph={`lim-bar-${r.id}`} data-morph-stretch>
                <span className={cn("block h-full rounded-full", fill)} style={{ width: `${fraction * 100}%` }} />
              </span>
            </li>
          )
        })}
      </ul>
    </>
  )
}
