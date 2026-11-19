"use client"

/**
 * What each widget shows on the page — the glance. Everything here is ONE
 * line per fact, truncated rather than wrapped, so a tile is the same height
 * whatever it says (the page is laid out to a phone's height and must not
 * move as the answers land). The detail behind each is in `details.tsx`.
 */

import { ChevronDown, OctagonAlert, TriangleAlert } from "lucide-react"
import { ChoicePicker } from "@/components/ui/option-menu"
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
  // Under each stop: out from the first, in at the last, and at a stop in
  // between BOTH — in from the leg before, out on the leg after ("01:50–02:35Z";
  // the owner: the next sector's out was missing).
  const at = (ms: number | null) => (ms !== null ? clock(ms) : "")
  const times =
    duty.times.length === legs.length && legs.length > 0
      ? [
          at(duty.times[0].departMs),
          ...duty.times.map((t, i) => {
            const arr = at(t.arriveMs)
            const next = duty.times[i + 1]
            if (!next) return arr
            const dep = at(next.departMs)
            if (!arr || !dep) return arr || dep
            return `${arr.replace(/Z$/, "")}–${dep}`
          }),
        ]
      : undefined
  return (
    <>
      <WidgetLabel>
        <span className="inline-flex items-center gap-0.5" suppressHydrationWarning>
          {dutyWord(brief)} · {day(duty.atMs)}
          {duty.choices.length > 1 && <ChevronDown className="h-3 w-3" aria-hidden />}
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
      <WidgetLabel>Destination</WidgetLabel>
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
}

const SEVERITY: Record<Requirement["state"], number> = { fail: 0, unknown: 1, caution: 1, ok: 2 }

/**
 * Everything the currency tile summarises, most pressing first: the logbook's
 * own requirements (90-day recency, sectors not logged, a read that failed)
 * and every document on the Currencies page, by the NAME that page gives it.
 * Within a state, the order is the page's — soonest first.
 */
export function currencyRows(brief: FlightBrief): CurrencyRow[] {
  const logbook = brief.status.legality.requirements
    .filter((r) => r.group === "currency" && !r.id.startsWith("doc-"))
    .map((r) => ({ key: r.id, name: r.label, state: r.state, figure: r.value }))
  const docs = [...brief.currency.attention, ...brief.currency.current].map((l) => ({
    key: `doc-${l.id}`,
    name: l.name,
    state: l.state,
    figure: l.lapsesBeforeDuty ? `${l.figure} · before duty` : l.figure,
  }))
  return [...logbook, ...docs].sort((a, b) => SEVERITY[a.state] - SEVERITY[b.state])
}

/**
 * The Currencies page at a glance: the three most pressing, and a tally of the
 * whole set — never "+N more": the card lists them all.
 */
export function CurrencyFace({ brief, rows = 3 }: { brief: FlightBrief; rows?: number }) {
  const all = currencyRows(brief)
  return (
    <>
      <WidgetLabel right={<Tally rows={all} />}>Currency</WidgetLabel>
      {all.length === 0 ? (
        <p className="text-xs leading-snug text-muted-foreground">None tracked</p>
      ) : (
        <ul className="space-y-1">
          {all.slice(0, rows).map((r) => {
            const Icon = STATE_ICON[r.state]
            return (
              <li key={r.key} className="flex items-center gap-1.5 text-xs leading-tight">
                {r.state === "ok" ? (
                  <span className="w-3 shrink-0" aria-hidden />
                ) : (
                  <Icon className={cn("h-3 w-3 shrink-0", REQ_TONE[r.state].icon)} aria-hidden />
                )}
                <span className="min-w-0 flex-1 truncate text-foreground">{r.name}</span>
                <span className={cn("shrink-0 font-semibold tabular-nums", r.state === "ok" ? "text-foreground" : REQ_TONE[r.state].icon)}>
                  {r.figure.split(" · ")[0]}
                </span>
              </li>
            )
          })}
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
      <WidgetLabel right={<Tally rows={limits} />}>Limits</WidgetLabel>
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
