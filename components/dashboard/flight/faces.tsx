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
import { limitOrder } from "@/lib/utils/dashboard/limit-detail"
import { limitsAt, type LimitAt } from "@/lib/utils/dashboard/deck-timeline"
import { useDeckPointer } from "@/hooks/use-deck-pointer"
import { cn } from "@/lib/utils"
import { formatDutyClock } from "@/lib/utils/dashboard/duty-status"
import { REQ_TONE, TONE } from "./instruments"
import { DutyClockFace, dutyClockView } from "./duty-clock"
import { WidgetLabel } from "./widget"
import { metarConditions } from "@/lib/weather/brief"
import { favouredRunway, runwayEndsFrom, type WindOnRunway } from "@/lib/weather/runway-wind"
import type { FlightBrief } from "./model"
import type { CrewMate } from "@/lib/utils/dashboard/flight-brief"
import { FACE_WIDE_COLS, type TileSize } from "@/lib/utils/dashboard/bento"
import { TileRows } from "./tile-rows"
import { PILOT_ROLES, roleLabel, type LogbookAuthority } from "@/lib/utils/logbook-rules"
import type { FlightLog, PilotRole } from "@/types/entities/flight.types"
import { addDays, localDayKey, lookAheadFor, type LookAhead } from "@/lib/utils/dashboard/currency-dots"
import { daysLeftAt } from "@/lib/utils/dashboard/currency-summary"
import { RECENCY_CAUTION_DAYS } from "@/lib/utils/dashboard/legality"
import { CurrencyDots } from "./currency-dots"
import { Pager, useRememberedPage } from "./pager"
import { onwardLines, whereaboutsLines } from "@/lib/lookup/aircraft-whereabouts"
import { MIN_TURN_MIN } from "@/lib/utils/dashboard/estimated-in"
import * as React from "react"
import { icaoTypeOfOfp } from "@/lib/briefing/aircraft"
import { normalizeRegistration } from "@/lib/utils/string"
import { scheduledInMs, scheduledOutMs } from "@/lib/utils/flight-day"
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
export function DutyFace({ brief, inCard = false, size }: { brief: FlightBrief; inCard?: boolean; size?: TileSize }) {
  return (
    <>
      <div
        aria-hidden
        className={cn("pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b to-transparent", TONE[brief.status.dutyState].glow)}
      />
      <div className="relative">
        <DutyClockFace brief={brief} inCard={inCard} size={size} />
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
  return brief.duty.current ? "Now" : brief.duty.index === 0 ? "Next" : brief.duty.index < 0 ? "Past" : "Later"
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
export function legLine(
  brief: FlightBrief,
  i: number,
): { kind: "inbound" | "onward"; text: string; late?: boolean; next?: string; nightStop?: boolean } | null {
  const { duty } = brief
  const f = duty.legs[i]
  if (!f) return null
  const sep = brief.display?.clockSeparator
  if (i === legNow(brief) && !f.inTime && !f.outTime) {
    const inbound = duty.lookups?.inbound
    const w = inbound?.status === "done" ? whereaboutsLines(inbound.whereabouts, brief.now, sep) : null
    // The flight number only — where it came from is the card's; the time it
    // landed is what decides the engines' idle and the APU on the turn. Its
    // arrival GATE is where our aeroplane is (the owner, Nov 2026: "one glance
    // info that I need") — unless it is the departure gate the tile already says.
    if (w) {
      const g = duty.lookups?.gates[f.id]
      const dep = g?.status === "done" ? g.gates.departure.gate : ""
      const arr = inboundGate(brief)
      return {
        kind: "inbound",
        text: [w.flight.split(" ")[0], arr && arr !== dep && `Arr ${arr}`, w.primary].filter(Boolean).join(" · "),
        late: inboundLate(brief, i),
      }
    }
  }
  if (i === duty.legs.length - 1) {
    // Changi's terminal "0" on our arrival: the aeroplane NIGHT-STOPS before
    // its next flight (the owner, Nov 2026) — said first, it decides how the
    // aeroplane is left.
    const stop = nightStopAfter(brief, i)
    const onward = duty.lookups?.onward
    const o = onward?.status === "done" ? onwardLines(onward.whereabouts, sep) : null
    const g = duty.lookups?.gates[f.id]
    const viaAirport = g?.status === "done" ? g.gates.onwardFlight : ""
    const next = o ? [o.flight.split(" ")[0], o.crew].filter(Boolean).join(" · ") : viaAirport
    if (next || stop) return { kind: "onward", text: [stop && "Night stop", next && `Next ${next}`].filter(Boolean).join(" · "), next, nightStop: stop }
  }
  return null
}

/**
 * The aeroplane night-stops after leg `i`: Changi's own record gives the
 * arrival terminal "0" when it is parked for the night before its next
 * flight (the owner, Nov 2026: "if icargo returns terminal 0, it means it is
 * a night stop for the next connecting flight"). Only a Singapore arrival —
 * that is the record that says so.
 */
export function nightStopAfter(brief: FlightBrief, i: number): boolean {
  const f = brief.duty.legs[i]
  const g = f ? brief.duty.lookups?.gates[f.id] : undefined
  if (g?.status !== "done") return false
  const at = g.gates.arrival
  return (at.airport === "SIN" || at.airport === "WSSS") && at.terminal.trim() === "0"
}

/** The inbound aeroplane's arrival gate — where ours is parked for the turn; "" until published. */
export function inboundGate(brief: FlightBrief): string {
  const w = brief.duty.lookups?.inbound
  return w?.status === "done" ? (w.whereabouts.inbound?.arrivalGate ?? "").trim() : ""
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

/**
 * " · 23:55–01:50Z" — the leg's SCHEDULE, always (the owner, Nov 2026: show
 * the schedule, and the actual with how early or late beside it); a leg with
 * no schedule (entered by hand) shows the times it has.
 */
export function scheduleRange(brief: FlightBrief, i: number): string {
  const f = brief.duty.legs[i]
  const t = brief.duty.times[i]
  const sep = brief.display?.clockSeparator
  if (isHHMM(f?.scheduledOut) && isHHMM(f?.scheduledIn)) return ` · ${formatClockDisplay(f.scheduledOut, sep)}–${formatClockDisplay(f.scheduledIn, sep)}Z`
  return t?.departMs != null && t?.arriveMs != null ? ` · ${brief.clock(t.departMs).replace(/Z$/, "")}–${brief.clock(t.arriveMs)}` : ""
}

/**
 * Beside the tile's schedule, what has happened against it: once off blocks
 * the recorded OUT's "OUT +0:33", once on blocks the IN's; before, a LIVE
 * delay the sources report ("OUT +0:40", from 10 minutes). Amber from 10 late.
 */
function LegChip({ brief, i }: { brief: FlightBrief; i: number }) {
  const f = brief.duty.legs[i]
  const t = brief.duty.times[i]
  if (!f) return null
  const end = isHHMM(f.inTime) ? ("IN" as const) : isHHMM(f.outTime) ? ("OUT" as const) : null
  if (end) {
    // How early or late, said against what it is ("OUT +0:33"); the recorded
    // time itself is the card's OUT / IN row — on a narrow tile it pushed the
    // schedule out of the line.
    const d = offSchedule(f, end, end === "IN" ? (t?.arriveMs ?? null) : (t?.departMs ?? null))
    const off = offScheduleText(d).replace(/[()]/g, "")
    if (!off) return null
    return (
      <span className={cn("shrink-0 whitespace-pre", d !== null && d >= DELAY_SAID_MIN ? "font-semibold text-status-warning" : "text-muted-foreground")} suppressHydrationWarning>
        {` · ${end} ${off}`}
      </span>
    )
  }
  const minutes = legDelay(brief, i)
  if (minutes === null) return null
  return <span className="shrink-0 whitespace-pre font-semibold text-status-warning"> · OUT +{formatDutyClock(minutes)}</span>
}

/**
 * Leg `i`'s aeroplane: its own (the logbook's, the inbound's on the leg the
 * pilot takes over, the source's), else — a turnaround, leaving where the leg
 * before arrived — the leg before's, marked EXPECTED (the owner, Nov 2026:
 * "Aircraft TBA" beside a known tail read as missing data).
 */
export function legAircraft(
  brief: FlightBrief,
  i: number,
): { reg: string; type: string; expected: boolean; from: string; via?: boolean } {
  const { duty } = brief
  const f = duty.legs[i]
  if (!f) return { reg: "", type: "", expected: false, from: "" }
  const g = duty.lookups?.gates[f.id]
  // The inbound lookup's registration is THIS leg's only where it was asked for
  // this leg — and then it came from one of the sources below already.
  const own = f.aircraftReg || (g?.status === "done" ? g.gates.flight.registration : "") || ""
  // As the aircraft database spells and types it (the Aircraft page's name).
  const rec = own ? brief.fleet?.get(normalizeRegistration(own)) : undefined
  if (own) return { reg: rec?.registration || own, type: rec?.typecode || f.aircraftType || "", expected: false, from: "" }
  // The leg's OFP names the aeroplane it is planned on.
  const plan = brief.planned?.[i]
  if (plan?.registration) {
    const p = brief.fleet?.get(normalizeRegistration(plan.registration))
    return { reg: p?.registration || plan.registration, type: p?.typecode || f.aircraftType || icaoTypeOfOfp(plan.aircraftType), expected: false, from: "" }
  }
  // The flight that brings the aeroplane in, or takes it on, names it
  // (`DutyLookups.viaConnection` — the owner: "we already know the connecting
  // flight TR537, we can do a lookup on TR537 aircraft in use").
  const via = duty.lookups?.viaConnection?.[f.id]
  if (via) {
    const v = brief.fleet?.get(normalizeRegistration(via.registration))
    return { reg: v?.registration || via.registration, type: v?.typecode || f.aircraftType || "", expected: true, from: via.via, via: true }
  }
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
 * A gate beside its airport: the number; the number in a DASHED outline where
 * it is taken across a short turn (`acrossTurns` — the other leg's gate,
 * expected, not published); or a dashed placeholder while it is awaited.
 */
function GateChip({ gate, from, asked, side }: { gate?: string; from?: string; asked: boolean; side: "Departure" | "Arrival" }) {
  if (!gate && !asked) return null
  return gate ? (
    <span
      className={cn(
        "shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold leading-none tracking-normal",
        from ? "border border-dashed border-muted-foreground/60 text-muted-foreground" : "bg-muted text-foreground",
      )}
      aria-label={from ? `${side} gate ${gate}, expected — ${from}'s gate` : `${side} gate ${gate}`}
    >
      {gate}
    </span>
  ) : (
    // A slot the gate will fill, narrow so the route keeps its room on a small phone.
    <span
      role="img"
      className="inline-flex h-[19px] w-6 shrink-0 items-center justify-center rounded-md border border-dashed border-muted-foreground/50 text-[11px] font-medium leading-none text-muted-foreground"
      aria-label={`${side} gate not yet published`}
    >
      –
    </span>
  )
}

/**
 * One leg as the flights tile has it (the owner, Nov 2026: "show aircraft in
 * use, gate, essentially flight info"): the route large; the flight number
 * and its times; the AEROPLANE (registration and type) and the GATE on a line
 * of their own; then the inbound's landing, or the flight after ours.
 */
function LegPage({ brief, i, more = false, lines = 3, gates: showGates = true, compactLine = false }: { brief: FlightBrief; i: number; more?: boolean; lines?: 1 | 2 | 3; gates?: boolean; compactLine?: boolean }) {
  const { duty, clock, code } = brief
  const f = duty.legs[i]
  const t = duty.times[i]
  const flown = !!f.inTime
  const gates = duty.info?.legGates[i]
  const { reg, type, expected } = legAircraft(brief, i)
  const line = legLine(brief, i)
  // The gates BESIDE their airports (the owner, Nov 2026: the departure gate
  // left of the departure, the arrival gate right of the arrival), a dashed
  // placeholder while a gate is still to be published — once the duty is
  // close enough for one to be asked.
  const asked = !!duty.lookups
  return (
    <>
      <p className="flex min-w-0 items-center gap-1.5 text-[17px] font-bold leading-tight tracking-tight text-foreground @[15rem]:text-[21px]">
        {showGates && <GateChip gate={gates?.dep} from={gates?.depFrom} asked={asked} side="Departure" />}
        <span className="min-w-0 truncate" data-morph={`fl-route-${i}`}>
          {code(f.departureIcao, f.departureIata)} – {code(f.arrivalIcao, f.arrivalIata)}
        </span>
        {showGates && <GateChip gate={gates?.arr} from={gates?.arrFrom} asked={asked} side="Arrival" />}
      </p>
      {/* The delay keeps its place when the line is short of room: the times give way first. */}
      <p className="mt-0.5 flex min-w-0 items-baseline text-[12px] leading-tight tabular-nums text-foreground">
        <span className="min-w-0 truncate" suppressHydrationWarning data-morph={`fl-num-${i}`}>
          <span className="font-semibold">{f.flightNumber || "Flight"}</span>
          {scheduleRange(brief, i)}
        </span>
        <LegChip brief={brief} i={i} />
      </p>
      {lines >= 2 && (
        <p className="truncate text-[12px] leading-tight tabular-nums" data-morph={`fl-ac-${i}`}>
          <span className={cn("font-semibold", reg ? "text-foreground" : "text-muted-foreground")}>{reg || "Aircraft TBA"}</span>
          {reg && type && <span className="text-muted-foreground"> {type}</span>}
          {expected && <span className="text-muted-foreground"> · expected</span>}
        </p>
      )}
      {lines >= 3 && (
        <p
          className={cn("truncate text-[11px] leading-tight", line?.late ? "font-semibold text-status-warning" : "text-muted-foreground")}
          suppressHydrationWarning
          data-morph={`fl-next-${i}`}
        >
          {(line?.text && (compactLine ? compactLegLine(line.text, showGates) : line.text)) || "\u00a0"}
        </p>
      )}
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

/**
 * The line under the aeroplane as a tile short of room has it: without how
 * long ago ("29m ago" — the time it landed says it), and narrower still
 * without the inbound's gate ("TR289 · Landed 19:31Z").
 */
export function compactLegLine(text: string, roomy: boolean): string {
  return text
    .split(" · ")
    .filter((p) => !/\bago$/.test(p) && (roomy || !/^Arr\b/.test(p)))
    .join(" · ")
}

/**
 * The leg's FLIGHT CREW on a panel at the tile's right (the owner, round 50:
 * "bring back previous flight card, where crew is displayed on the right").
 * Each a line: initials, name, the seat as the pilot's logbook rules name it
 * and how often they have flown together — or, on a narrow tile, the
 * initials alone, a column of them. The cabin is the card's.
 */
function CrewPanel({ brief, crew, names, max }: { brief: FlightBrief; crew: CrewMate[]; names: boolean; max: number }) {
  const flightCrew = crew.filter((m) => !m.cabin)
  if (flightCrew.length === 0) return null
  const shown = flightCrew.slice(0, Math.max(1, max))
  const role = (r: string) => crewRole(r, brief.authority)
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col justify-center gap-1.5 self-stretch border-l border-border/60 bg-muted/40",
        names ? "-my-3 -mr-3 w-[40%] max-w-44 rounded-r-2xl px-2.5 py-3" : "-my-3 -mr-3 w-10 items-center rounded-r-2xl py-3",
      )}
      aria-label={names ? undefined : shown.map((m) => shortName(m.name)).join(", ")}
    >
      {shown.map((m) => (
        <div key={m.personId ?? m.name} className="flex min-w-0 items-center gap-1.5">
          <span
            title={shortName(m.name)}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-card text-[9px] font-semibold text-foreground"
            data-morph={`crew-ini-${crewKey(m)}`}
          >
            {initialsOf(m.name)}
          </span>
          {names && (
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-[12px] font-medium text-foreground" data-morph={`crew-name-${crewKey(m)}`}>
                {shortName(m.name)}
              </span>
              {/* The role and the history fly into the card's row (its caption and its right). */}
              <span className="block truncate text-[10px] tabular-nums text-muted-foreground">
                <span data-morph={`crew-role-${crewKey(m)}`}>{role(m.role)}</span>
                {" · "}
                <span data-morph={`crew-last-${crewKey(m)}`}>{m.last ? `${m.count}×` : "New"}</span>
              </span>
            </span>
          )}
        </div>
      ))}
      {flightCrew.length > shown.length && (
        <p className={cn("text-[10px] text-muted-foreground", names && "pl-7")}>+{flightCrew.length - shown.length}</p>
      )}
    </div>
  )
}

/**
 * FLIGHT & CREW — the chosen duty's legs (the owner, round 50: the duty is a
 * tile of its own again, and the crew back on the right). Its eyebrow (Now /
 * Next / Later / Past · the day, "Leg 1/2"), then a leg a page — route with
 * its gates, number and times, the aeroplane, the inbound or the flight after
 * — and the leg's flight crew on a panel at the right (`CrewPanel`).
 *
 * It fits its size (`FlightFaceSize`): one row tall it is the route and the
 * number line, the crew as initials; narrower than a phone's half, no panel.
 */
export function FlightFace({
  brief,
  size,
  inCard = false,
  fill = false,
}: {
  brief: FlightBrief
  size: TileSize
  inCard?: boolean
  fill?: boolean
}) {
  const { duty, day } = brief
  const count = duty.legs.length
  const [page, setPage] = useRememberedPage(`flight:${duty.atMs}`, legNow(brief), count)
  if (duty.atMs === null || duty.standby)
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <WidgetLabel title>Flight</WidgetLabel>
        <p className="text-[15px] font-semibold text-muted-foreground">{duty.standby ? duty.standby.code : "Nothing rostered"}</p>
      </div>
    )
  const fit = flightFaceSize(size, inCard, fill)
  // A WIDE tile (a desktop's full width) lays its legs side by side — each
  // about a phone third and a half — beside the crew.
  const room = size.cols - (fit.crew === "names" ? 1.45 : 0.4)
  const per = fit.wide ? Math.max(1, Math.min(count, Math.floor(room / LEG_COLS))) : 1
  // The crew of the leg on show — of the first leg on show, side by side.
  const first = per > 1 ? Math.floor(page / per) * per : page
  const crew = count ? (brief.legCrew[first] ?? brief.crew) : brief.crew
  const { legs, route } = chainOf(brief)
  const stops = legs.length ? [legs[0].from, ...legs.map((l) => l.to)] : (route ?? "").split("-").filter(Boolean)
  const shownTo = Math.min(count, first + per)
  const legLabel = per > 1 ? (count > per ? `Legs ${first + 1}–${shownTo}/${count}` : null) : `Leg ${page + 1}/${count}`
  return (
    <div className="flex min-h-0 min-w-0 flex-1 gap-3">
      <div className="flex min-w-0 flex-1 flex-col">
        {fit.eyebrow && (
          <WidgetLabel
            right={
              count > 1 && legLabel ? (
                <span className="shrink-0 text-[10px] font-semibold tabular-nums text-muted-foreground" data-morph="fl-legn">
                  {fit.gates ? legLabel : legLabel.replace(/^Legs? /, "")}
                </span>
              ) : undefined
            }
          >
            <span suppressHydrationWarning>
              {dutyWord(brief)} · {fit.gates ? day(duty.atMs) : day(duty.atMs).replace(/^\w+,?\s*/, "")}
            </span>
          </WidgetLabel>
        )}
        {/* A container: beside the crew the leg has ~200px of a phone, and a
            three-stop route at 21px does not fit it (measured at 360). */}
        <div className="@container flex min-h-0 min-w-0 flex-1 flex-col">
          {count === 0 ? (
            <p className="truncate text-[17px] font-bold leading-tight tracking-tight text-foreground @[15rem]:text-[21px]" data-morph="fl-route">
              {stops.join(stops.length > 2 ? "–" : " – ") || "—"}
            </p>
          ) : (
            <Pager count={count} page={page} onPage={setPage} morph="fl" perPage={per} fill={fill} dots={fit.dots} dotTone={(i) => (legLate(brief, i) ? "caution" : undefined)}>
              {(i) => <LegPage brief={brief} i={i} more={fill} lines={fit.lines} gates={fit.gates} compactLine={!fit.wide} />}
            </Pager>
          )}
        </div>
      </div>
      {fit.crew && <CrewPanel brief={brief} crew={crew} names={fit.crew === "names"} max={fit.crewMax} />}
    </div>
  )
}

/**
 * What the flights face has room for at a size (a face's size: columns in
 * thirds of a phone's row, rows in the old grid's ~164px rows). Each step
 * drops what matters least first: the eyebrow (the timeline names the duty),
 * then the line under the aeroplane, then the aeroplane; the crew from names
 * to initials to none.
 */
export interface FlightFaceFit {
  eyebrow: boolean
  /** Lines of the leg below the route: 1 the number, 2 + the aeroplane, 3 + the inbound / onward. */
  lines: 1 | 2 | 3
  crew: "names" | "initials" | null
  crewMax: number
  dots: boolean
  wide: boolean
  /** The gates beside the route: only where the route keeps its room (half a phone's row and wider has none to spare). */
  gates: boolean
}

export function flightFaceSize(size: TileSize, inCard = false, fill = false): FlightFaceFit {
  if (inCard) return { eyebrow: true, lines: 3, crew: null, crewMax: 0, dots: true, wide: false, gates: true }
  const short = size.rows < 0.75
  const low = size.rows < 1.1
  return {
    eyebrow: !low || fill,
    lines: short ? 1 : low ? 2 : 3,
    crew: size.cols >= 2.5 ? (short ? "initials" : "names") : size.cols >= 2 ? "initials" : null,
    crewMax: short ? 2 : 3,
    dots: !short,
    wide: size.cols >= FACE_WIDE_COLS,
    gates: size.cols >= 2.5,
  }
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
 * Leg `i` in the flights CARD, in the order it runs: the inbound aeroplane,
 * our aeroplane, the departure gate, OUT and IN (the schedule until recorded,
 * then the recorded time with its "(+0:33)"), the arrival gate, the flight
 * after ours. No estimates, no block, no terminals (the owner, Nov 2026).
 */
export function legRows(brief: FlightBrief, i: number): CardRow[] {
  const { duty } = brief
  const f = duty.legs[i]
  const t = duty.times[i]
  const sep = brief.display?.clockSeparator
  const flown = !!f.inTime
  const g = duty.lookups?.gates[f.id]
  const gates = g?.status === "done" ? g.gates : null
  const line = legLine(brief, i)
  const ac = legAircraft(brief, i)
  const rows: CardRow[] = []
  // The aeroplane coming in, on the leg the pilot takes it over for. Its
  // arrival gate rides in the line (`legLine`) unless it is our departure gate.
  const inbound = duty.lookups?.inbound
  const w = line?.kind === "inbound" && inbound?.status === "done" ? whereaboutsLines(inbound.whereabouts, brief.now, sep) : null
  if (line?.kind === "inbound") {
    rows.push({
      label: "Inbound",
      value: line.text,
      sub: [w?.flight.split(" ").slice(1).join(" "), w?.std].filter(Boolean).join(" · ") || undefined,
      tone: line.late ? "caution" : undefined,
      morph: `fl-next-${i}`,
    })
  } else if (gates?.inboundFlight && !flown && !f.outTime) {
    rows.push({ label: "Inbound", value: gates.inboundFlight })
  }
  // The flight that takes the aeroplane over after ours — at the TOP with the
  // inbound (the owner, Nov 2026: "so users know where to look for
  // connecting flight").
  if (line?.kind === "onward") {
    const onward = duty.lookups?.onward
    const o = onward?.status === "done" ? onwardLines(onward.whereabouts, sep) : null
    rows.push({
      label: "Next Flight",
      value: line.next || "Night stop",
      sub: [line.next && line.nightStop && "Night stop", o?.flight.split(" ").slice(1).join(" "), o?.std].filter(Boolean).join(" · ") || undefined,
      morph: `fl-next-${i}`,
    })
  }
  rows.push({
    label: "Aircraft",
    value: ac.reg ? `${ac.reg}${ac.type ? ` ${ac.type}` : ""}` : "TBA",
    sub: ac.via
      ? `Expected · as ${ac.from}, the connecting flight`
      : ac.expected
        ? `Expected · after ${ac.from || "the leg before"}, not yet confirmed`
        : undefined,
    morph: `fl-ac-${i}`,
  })
  // The TURN before this leg: the time on the ground since the leg before
  // landed (recorded IN, else its schedule), against this leg's OUT —
  // what the turnaround allows for the walk-round, fuel and the brief.
  const turnMin = turnBefore(brief, i)
  if (turnMin !== null) {
    const prev = duty.legs[i - 1]
    rows.push({
      label: "Turn",
      value: formatDutyClock(Math.max(0, turnMin)),
      sub: `At ${brief.code(prev.arrivalIcao, prev.arrivalIata)}${turnMin < MIN_TURN_MIN ? " · short" : ""}`,
      tone: turnMin < MIN_TURN_MIN ? "caution" : undefined,
    })
  }
  // The gate number alone (the owner, Nov 2026: "remove all terminal … gate
  // number is good enough"); a stand only where no gate is published.
  const gateOf = (x: { gate: string; stand?: string } | undefined) => (x?.gate ? `Gate ${x.gate}` : x?.stand ? `Stand ${x.stand}` : "")
  // Where the leg's own gate is not published, the one across a short turn
  // (`acrossTurns`), said as expected.
  const turn = duty.info?.legGates[i]
  const dep = gateOf(gates?.departure)
  if (dep) rows.push({ label: "Departure", value: dep })
  else if (turn?.depFrom && turn.dep) rows.push({ label: "Departure", value: `Gate ${turn.dep}`, sub: `Expected · ${turn.depFrom} arrives there` })
  // OUT and IN, ONE row each (the owner, Nov 2026: estimates "not very useful
  // during flight. And confusing"): the schedule until the time is recorded,
  // then the recorded time with how early or late it was beside it.
  rows.push(timeRow(brief, i, "OUT", f.outTime, f.scheduledOut, t?.departMs ?? null))
  rows.push(timeRow(brief, i, "IN", f.inTime, f.scheduledIn, f.inTime ? (t?.arriveMs ?? null) : null))
  const arr = gateOf(gates?.arrival)
  if (arr) rows.push({ label: "Arrival", value: arr })
  else if (turn?.arrFrom && turn.arr) rows.push({ label: "Arrival", value: `Gate ${turn.arr}`, sub: `Expected · ${turn.arrFrom} leaves from it` })
  return rows
}

const isHHMM = (t?: string | null): t is string => !!t && /^\d{1,2}:\d{2}$/.test(t)

/**
 * Minutes on the ground before leg `i` (round 51: the turnaround is what a
 * pilot plans the walk-round, fuel and the brief into) — the leg before's
 * IN (recorded, else live, else scheduled) to this leg's OUT (the same);
 * null for the first leg, or where either end is unknown.
 */
export function turnBefore(brief: FlightBrief, i: number): number | null {
  if (i <= 0) return null
  const est = brief.duty.estimate
  const a = brief.duty.times[i - 1]
  const b = brief.duty.times[i]
  const inMs = brief.duty.legs[i - 1]?.inTime ? a?.arriveMs : (est?.legs[i - 1]?.inMs ?? a?.arriveMs)
  const outMs = brief.duty.legs[i]?.outTime ? b?.departMs : (est?.legs[i]?.outMs ?? b?.departMs)
  if (inMs == null || outMs == null) return null
  return Math.round((outMs - inMs) / 60_000)
}

/** An hour after the leg should have landed (the live estimate, else the schedule) with no IN recorded: a gap in the logbook. */
const UNLOGGED_AFTER_MS = 60 * 60_000
function unloggedLeg(brief: FlightBrief, i: number): boolean {
  const f = brief.duty.legs[i]
  if (!f || isHHMM(f.inTime)) return false
  const sched = scheduledInMs(f)
  const est = brief.duty.estimate?.legs[i]?.inMs ?? null
  const due = Math.max(sched ?? 0, est ?? 0)
  return due > 0 && brief.now > due + UNLOGGED_AFTER_MS
}

/** Minutes leg `f`'s recorded OUT or IN is from its schedule (negative early); null without both. */
export function offSchedule(f: FlightLog, end: "OUT" | "IN", actualMs: number | null): number | null {
  // The schedule against the OUT the flight is dated by (`lib/utils/flight-day`).
  const s = end === "OUT" ? scheduledOutMs(f) : scheduledInMs(f)
  return actualMs === null || s === null ? null : Math.round((actualMs - s) / 60_000)
}

/** "(+0:33)", "(−0:05)", "" on time — a recorded time against its schedule. */
export function offScheduleText(min: number | null): string {
  if (min === null || min === 0) return ""
  return min > 0 ? `(+${formatDutyClock(min)})` : `(−${formatDutyClock(-min)})`
}

/** One end of a leg: "23:55Z Sch" until recorded, then "00:28Z (+0:33)" — amber only from 10 minutes late. */
function timeRow(brief: FlightBrief, i: number, label: "OUT" | "IN", actual: string | undefined, scheduled: string | undefined, actualMs: number | null): CardRow {
  const f = brief.duty.legs[i]
  const sep = brief.display?.clockSeparator
  const z = (hhmm: string) => `${formatClockDisplay(hhmm, sep)}Z`
  if (isHHMM(actual)) {
    const d = offSchedule(f, label, actualMs)
    const off = offScheduleText(d)
    return {
      label,
      value: (
        <>
          {z(actual)}
          {off && <span className="ml-1 text-[12px] font-medium">{off}</span>}
        </>
      ),
      tone: d !== null && d >= DELAY_SAID_MIN ? "caution" : undefined,
    }
  }
  if (!isHHMM(scheduled)) return { label, value: "—" }
  // After the flight: landed by now, and nothing in the logbook (the pilot's
  // last job of the day, the record).
  const gap = label === "IN" && unloggedLeg(brief, i)
  return {
    label,
    sub: gap ? "Not logged" : undefined,
    tone: gap ? "caution" : undefined,
    value: (
      <>
        <span className="mr-1 text-[11px] font-normal text-muted-foreground">Sch</span>
        {z(scheduled)}
      </>
    ),
  }
}

function CardLeg({ brief, i }: { brief: FlightBrief; i: number }) {
  const { duty, code } = brief
  const f = duty.legs[i]
  const rows = legRows(brief, i)
  return (
    <>
      <p className="truncate text-[21px] font-bold leading-tight tracking-tight text-foreground" data-morph={`fl-route-${i}`}>
        {code(f.departureIcao, f.departureIata)} – {code(f.arrivalIcao, f.arrivalIata)}
      </p>
      <p className="mt-0.5 truncate text-[12px] leading-tight tabular-nums text-foreground" suppressHydrationWarning data-morph={`fl-num-${i}`}>
        <span className="font-semibold">{f.flightNumber || "Flight"}</span>
        {scheduleRange(brief, i)}
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
 * timeline, then a leg a page — swiped as the tile is — the leg on show's
 * Open under the pages and the dots under it, then the duty's own table
 * (`duty`, the Duty & FDP rows), apart from the legs (the owner).
 */
export function FlightCardLegs({ brief, openFlight, duty: dutyNode }: { brief: FlightBrief; openFlight: (id: string) => void; duty?: React.ReactNode }) {
  const { duty, day } = brief
  const count = duty.legs.length
  const [page, setPage] = useRememberedPage(`flight:${duty.atMs}`, legNow(brief), count)
  if (duty.atMs === null) return <p className="py-1 text-[13px] text-muted-foreground">Nothing rostered</p>
  // The leg's Open goes with the LEG, its dots under it (not swiped); the
  // duty's table follows the pager, apart from it (the owner, Nov 2026: Open
  // "should not be in duty & FDP area").
  return (
    <div>
      <WidgetLabel right={count > 1 ? <span className="text-[10px] font-semibold tabular-nums text-muted-foreground" data-morph="fl-legn">Leg {page + 1}/{count}</span> : undefined}>
        <span suppressHydrationWarning>
          {dutyWord(brief)} · {day(duty.atMs)}
        </span>
      </WidgetLabel>
      {count === 0 ? (
        <>
          <p className="truncate text-[21px] font-bold leading-tight tracking-tight text-foreground" data-morph="fl-route">
            {(chainOf(brief).route ?? "").split("-").filter(Boolean).join(" – ") || "—"}
          </p>
        </>
      ) : (
        <Pager
          count={count}
          page={page}
          onPage={setPage}
          morph="fl"
          dotTone={(i) => (legLate(brief, i) ? "caution" : undefined)}
          below={<OpenFlight brief={brief} i={page} openFlight={openFlight} />}
        >
          {(i) => <CardLeg brief={brief} i={i} />}
        </Pager>
      )}
      {dutyNode}
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
  // ONE short row has no room for the dots (seven deep): the closest
  // currencies as figures over their names — one in a third of the row, two
  // in half, three across it — the figure in its state's colour.
  if (!fill && size.rows < 0.75 && all.length > 0) {
    const n = size.cols >= 2.5 ? 3 : size.cols >= 1.25 ? 2 : 1
    return (
      <>
        <WidgetLabel title right={<MoreFlagged rows={all.slice(n)} />}>
          Currency
        </WidgetLabel>
        <div className="mt-auto flex items-end gap-2">
          {all.slice(0, n).map((r) => (
            <div key={r.key} className="min-w-0 flex-1">
              <span
                className={cn("block truncate text-[20px] font-semibold leading-tight tabular-nums", r.state === "ok" ? "text-foreground" : REQ_TONE[r.state].icon)}
                data-morph={`cur-fig-${r.key}`}
              >
                {r.figure.split(" · ")[0]}
              </span>
              <span className="line-clamp-2 block text-[10px] leading-tight text-muted-foreground" data-morph={`cur-name-${r.key}`}>
                {r.name}
              </span>
            </div>
          ))}
        </div>
      </>
    )
  }
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
                stacked={third}
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
/**
 * The four limits at the TIMELINE's pointer (the owner, Nov 2026: "limits also
 * change as we scroll the timeline"): continuous windows read at its instant
 * (`limitsAt`), now while it follows the clock — re-read each minute the
 * pointer moves through, and only this tile re-renders for it.
 */
export function useLimitsAtPointer(brief: FlightBrief): { rows: LimitAt[]; atMs: number | null } {
  const pointer = useDeckPointer()
  const minute = Math.floor((pointer ?? brief.now) / 60_000)
  const rows = React.useMemo(() => limitsAt(brief.rolling, minute * 60_000), [brief.rolling, minute])
  return { rows, atMs: pointer }
}

/** "62" — hours left, rounded DOWN (headroom is never overstated). */
const hoursLeftOf = (minutes: number) => String(Math.max(0, Math.floor(minutes / 60)))

export function LimitsFace({ brief, size, fill = false }: { brief: FlightBrief; size?: TileSize; fill?: boolean }) {
  // In concern first, else the regulation's order (`limitOrder`).
  const { rows, atMs } = useLimitsAtPointer(brief)
  const limits = limitOrder(rows, (id) => rows.find((r) => r.id === id)?.state)
  // A third of the row: the figure alone ("81h").
  const narrow = (size?.cols ?? 3) < 2
  // WIDE: two columns, each with what is used against its limit.
  const wide = (size?.cols ?? 3) >= FACE_WIDE_COLS
  // ONE short row: a phone's width holds the four in pairs; narrower, the
  // two that lead (in concern first, else the regulation's first two).
  const short = !fill && (size?.rows ?? 1) < 0.75
  const pairs = wide || (short && !narrow && (size?.cols ?? 3) >= 2.5)
  const shown = short && !pairs ? limits.slice(0, 2) : limits
  return (
    <>
      <WidgetLabel title>
        Limits
        {/* Scrolled away from now: the instant they are read at. */}
        {/* A narrow tile has room for the day alone. */}
        {atMs !== null && (
          <span className="font-medium normal-case tracking-normal" suppressHydrationWarning>
            {" · "}
            {brief.day(atMs).replace(/^\w+,?\s*/, "")}
            {!narrow && ` ${brief.clock(atMs)}`}
          </span>
        )}
      </WidgetLabel>
      {/* The rows share the tile's height, so a tall tile has no empty foot. */}
      {/* Filling the page's height, the rows under it take the room (`TileRows`). */}
      <ul className={cn(pairs ? "grid grid-cols-2 gap-x-5 gap-y-2" : fill ? "flex flex-col gap-2" : "flex min-h-0 flex-1 flex-col justify-around gap-1.5")}>
        {shown.map((r) => {
          // What is LEFT is the question ("how much more"); the bar shows what is used.
          const left = hoursLeftOf(r.remainingMinutes)
          const fraction = Math.min(1, Math.max(0, r.fraction))
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
                  {!narrow && !(pairs && !wide) && <span className={r.state === "ok" ? "text-muted-foreground" : REQ_TONE[r.state].icon}>{word}</span>}
                  {wide && <span className="text-muted-foreground"> · {Math.floor(r.usedMinutes / 60)} / {Math.round(r.limitMinutes / 60)}h</span>}
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
