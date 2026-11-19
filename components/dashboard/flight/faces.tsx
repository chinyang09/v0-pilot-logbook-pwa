"use client"

/**
 * What the flight dashboard's faces and cards share: the chosen duty's chain,
 * the rest before a later duty, the areas' ordering helpers, and the ‹ › that
 * chooses the duty. The faces themselves are `areas.tsx`.
 */

import { ChevronLeft, ChevronRight } from "lucide-react"
import type { Requirement } from "@/lib/utils/dashboard/legality"
import type { SectorLeg } from "@/lib/utils/dashboard/duty-status"
import { formatDay } from "@/lib/utils/date"
import { formatDutyClock, formatRestSpan } from "@/lib/utils/dashboard/duty-status"
import type { FlightBrief } from "./model"

/** "18 Nov" — a stored day, as a tile has room for it. */
export const shortDay = (ymd: string) => formatDay(ymd, { weekday: false, year: false })

/** "Woon Kok Heng, Benson" → "Woon Kok Heng": the name before the given name. */
export const shortName = (name: string) => name.split(",")[0].trim()

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

/** The rest before a later duty, against its own minimum: "Rest 15:20 · Min 12:00". */
export function restBeforeText(brief: FlightBrief): { text: string; short: boolean } | null {
  const r = brief.duty.restBefore
  if (!r) return null
  return { text: `Rest ${formatRestSpan(r.restMinutes)} · Min ${formatDutyClock(r.requiredRestMinutes)}`, short: !r.compliant }
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

/* ── Destinations ────────────────────────────────────────────────────────── */

/** The airports worth asking "when was I last there" about — not where the duty starts. */
export function destinationsOf(brief: FlightBrief) {
  const origin = (brief.duty.legs[0]?.departureIcao || "").toUpperCase()
  return brief.destinations.filter((d) => d.icao !== origin)
}

/* ── Currency and limits ─────────────────────────────────────────────────── */

/** Most pressing first: flagged by urgency, then the nearest expiry. */
export function orderCurrency(reqs: Requirement[]): Requirement[] {
  return [...reqs].sort(
    (a, b) =>
      (b.urgency ?? -1) - (a.urgency ?? -1) || (a.daysUntil ?? 9e9) - (b.daysUntil ?? 9e9),
  )
}

const LIMIT_ORDER = ["duty-14", "duty-28", "flight-28", "flight-365"]

export function limitsOf(brief: FlightBrief): Requirement[] {
  const byId = new Map(brief.status.legality.requirements.filter((r) => r.group === "limits").map((r) => [r.id, r]))
  return LIMIT_ORDER.map((id) => byId.get(id)).filter((r): r is Requirement => !!r)
}
