"use client"

/**
 * What each widget shows on the page — the glance. Everything here is ONE
 * line per fact, truncated rather than wrapped, so a tile is the same height
 * whatever it says (the page is laid out to a phone's height and must not
 * move as the answers land). The detail behind each is in `details.tsx`.
 */

import { Check, ChevronLeft, ChevronRight, OctagonAlert, TriangleAlert } from "lucide-react"
import type { Requirement } from "@/lib/utils/dashboard/legality"
import type { SectorLeg } from "@/lib/utils/dashboard/duty-status"
import { formatDay } from "@/lib/utils/date"
import { cn } from "@/lib/utils"
import { formatDutyClock, formatRestSpan } from "@/lib/utils/dashboard/duty-status"
import { DutyBand, REQ_TONE, STATE_ICON, SectorChain, TONE } from "./instruments"
import { WidgetLabel } from "./widget"
import type { FlightBrief } from "./model"

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

export function FlightFace({ brief }: { brief: FlightBrief }) {
  const { duty, clock, day } = brief
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
  // The aeroplane is named once: in the line under the chain, which says
  // where it is when that is known.
  const line = duty.info?.line ?? [reg, rest?.text].filter(Boolean).join(" · ")
  const times =
    duty.times.length === legs.length && legs.length > 0
      ? [
          duty.times[0].departMs !== null ? clock(duty.times[0].departMs) : "",
          ...duty.times.map((t) => (t.arriveMs !== null ? clock(t.arriveMs) : "")),
        ]
      : undefined
  return (
    <>
      <WidgetLabel>
        <span suppressHydrationWarning>
          {dutyWord(brief)} · {day(duty.atMs)}
        </span>
      </WidgetLabel>
      {(numbers.length > 0 || duty.fdp) && (
        <p className="-mt-0.5 mb-1.5 flex items-baseline justify-between gap-2 text-sm font-semibold text-foreground">
          <span className="min-w-0 truncate">{numbers.join(" · ")}</span>
          {duty.fdp && (
            // What this duty ASKS of the pilot: its FDP against its own Reg 14
            // maximum (the duty card says what NOW asks).
            <span
              className={cn(
                "shrink-0 text-[11px] font-medium tabular-nums",
                duty.fdp.max > 0 && duty.fdp.planned > duty.fdp.max ? "text-destructive" : "text-muted-foreground",
              )}
            >
              FDP {formatDutyClock(duty.fdp.planned)}
              {duty.fdp.max > 0 && `/${formatDutyClock(duty.fdp.max)}`}
            </span>
          )}
        </p>
      )}
      <SectorChain legs={legs} nextRoute={route} legGates={duty.info?.legGates} times={times} />
      {line && (
        <p
          className={cn(
            "mt-2 truncate text-[11px] leading-tight",
            !duty.info && rest?.short ? "text-destructive" : "text-muted-foreground",
          )}
          suppressHydrationWarning
        >
          {line}
        </p>
      )}
    </>
  )
}

/**
 * ‹ › on the flight tile: which duty the dashboard is about. The duty in
 * progress (or the next) by default; the later ones a tap each.
 */
export function DutyStepper({
  index,
  count,
  onStep,
}: {
  index: number
  count: number
  onStep: (delta: number) => void
}) {
  if (count < 2) return null
  const btn =
    "relative flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors active:bg-muted disabled:opacity-30 after:absolute after:-inset-1.5 after:content-['']"
  return (
    <div className="flex items-center gap-0.5">
      <button type="button" className={btn} disabled={index === 0} aria-label="Earlier duty" onClick={() => onStep(-1)}>
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="w-7 text-center text-[10px] font-semibold tabular-nums text-muted-foreground" aria-live="polite">
        {index + 1}/{count}
      </span>
      <button type="button" className={btn} disabled={index >= count - 1} aria-label="Later duty" onClick={() => onStep(1)}>
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  )
}

/* ── Crew ────────────────────────────────────────────────────────────────── */

export function CrewFace({ brief }: { brief: FlightBrief }) {
  const { crew, duty } = brief
  return (
    <>
      <WidgetLabel>Crew</WidgetLabel>
      {crew.length === 0 ? (
        <p className="text-xs leading-snug text-muted-foreground">—</p>
      ) : (
        <ul className="space-y-0.5">
          {crew.slice(0, 3).map((m) => (
            <li key={m.personId ?? m.name} className="text-xs leading-tight">
              <span className="block truncate font-medium text-foreground">{shortName(m.name)}</span>
              <span className="block truncate text-[10px] text-muted-foreground">
                {m.last ? shortDay(m.last.date) : "New"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/* ── Destinations ────────────────────────────────────────────────────────── */

/** The airports worth asking "when was I last there" about — not where the duty starts. */
export function destinationsOf(brief: FlightBrief) {
  const origin = (brief.duty.legs[0]?.departureIcao || "").toUpperCase()
  return brief.destinations.filter((d) => d.icao !== origin)
}

export function DestinationFace({ brief }: { brief: FlightBrief }) {
  const dests = destinationsOf(brief)
  return (
    <>
      <WidgetLabel>Last There</WidgetLabel>
      {dests.length === 0 ? (
        <p className="text-xs leading-snug text-muted-foreground">—</p>
      ) : (
        <ul className="space-y-0.5">
          {dests.slice(0, 3).map((d) => (
            <li key={d.icao} className="flex items-baseline justify-between gap-1.5 text-xs leading-tight">
              <span className="truncate font-medium text-foreground">{brief.code(d.icao)}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{d.last ? shortDay(d.last.date) : "First"}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/* ── Currency and limits ─────────────────────────────────────────────────── */

/** Most pressing first: flagged by urgency, then the nearest expiry. */
export function orderCurrency(reqs: Requirement[]): Requirement[] {
  return [...reqs].sort(
    (a, b) =>
      (b.urgency ?? -1) - (a.urgency ?? -1) || (a.daysUntil ?? 9e9) - (b.daysUntil ?? 9e9),
  )
}

function Tally({ requirements }: { requirements: Requirement[] }) {
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
      {fail === 0 && caution === 0 && requirements.length > 0 && <Check className="h-3 w-3 text-chart-2" aria-label="All met" />}
    </span>
  )
}

export function CurrencyFace({ brief, rows = 3 }: { brief: FlightBrief; rows?: number }) {
  const reqs = orderCurrency(brief.status.legality.requirements.filter((r) => r.group === "currency"))
  return (
    <>
      <WidgetLabel right={<Tally requirements={reqs} />}>Currency</WidgetLabel>
      {reqs.length === 0 ? (
        <p className="text-xs leading-snug text-muted-foreground">None tracked</p>
      ) : (
        <ul className="space-y-1">
          {reqs.slice(0, rows).map((r) => {
            const Icon = STATE_ICON[r.state]
            return (
              <li key={r.id} className="flex items-center gap-1.5 text-xs leading-tight">
                <Icon className={cn("h-3 w-3 shrink-0", REQ_TONE[r.state].icon)} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-foreground">{r.label}</span>
                <span className={cn("shrink-0 font-semibold tabular-nums", r.state === "ok" ? "text-foreground" : REQ_TONE[r.state].icon)}>
                  {r.value}
                </span>
              </li>
            )
          })}
          {reqs.length > rows && <li className="text-[10px] text-muted-foreground">+{reqs.length - rows} more</li>}
        </ul>
      )}
    </>
  )
}

const LIMIT_ORDER = ["duty-14", "duty-28", "flight-28", "flight-365"]

export function limitsOf(brief: FlightBrief): Requirement[] {
  const byId = new Map(brief.status.legality.requirements.filter((r) => r.group === "limits").map((r) => [r.id, r]))
  return LIMIT_ORDER.map((id) => byId.get(id)).filter((r): r is Requirement => !!r)
}

export function LimitsFace({ brief }: { brief: FlightBrief }) {
  const limits = limitsOf(brief)
  return (
    <>
      <WidgetLabel right={<Tally requirements={limits} />}>Limits</WidgetLabel>
      <ul className="space-y-1.5">
        {limits.map((r) => {
          const [used, limit] = r.value.split(" / ")
          const fraction = Math.min(1, Math.max(0, r.progress ?? 0))
          const fill = r.state === "ok" ? "bg-muted-foreground" : REQ_TONE[r.state].fill
          return (
            <li key={r.id} className="text-[11px] leading-none">
              <span className="flex items-baseline justify-between gap-1">
                <span className="truncate text-muted-foreground">{r.label}</span>
                <span className="shrink-0 tabular-nums">
                  <span className={cn("font-semibold", r.state === "ok" ? "text-foreground" : REQ_TONE[r.state].icon)}>{used}</span>
                  <span className="text-muted-foreground">/{limit}</span>
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
