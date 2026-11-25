/**
 * The four rolling limits as a pilot asks about them when the limits card is
 * opened (the owner, Nov 2026): how much HEADROOM is left, WHAT is pushing it
 * (the duties counted in the window), WHEN capacity frees up (the oldest day
 * rolling out), and what the NEXT duty and the roster ahead do to it.
 *
 * Read off the same duty periods and the same rolling sum the limits bars use
 * (`calculateRollingStats` — `days` whole UTC days ending on the as-of day;
 * duty as `countedDutyMinutes ?? dutyMinutes`, so a home standby counts its
 * 20%), so the card and the tile cannot disagree. Pure, so it is tested
 * (`limit-detail.test.ts`).
 */

import { calculateRollingStats } from "@/lib/utils/roster/fdp-calculator"
import { DEFAULT_FTL_LIMITS, type DutyPeriod, type FTLLimits } from "@/types/entities/roster.types"

export type LimitId = "duty-14" | "duty-28" | "flight-28" | "flight-365"

const DAY = 86_400_000
const dayMs = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`)
const utcDay = (ms: number) => Math.floor(ms / DAY) * DAY

interface Window {
  id: LimitId
  label: string
  days: number
  field: "duty" | "flight"
  limitHours: (l: FTLLimits) => number
}

/** The four windows, in the regulation's pairs (Reg 12, Reg 107). */
export const LIMIT_WINDOWS: Window[] = [
  { id: "duty-14", label: "Duty 14d", days: 14, field: "duty", limitHours: (l) => l.maxDuty14Days },
  { id: "duty-28", label: "Duty 28d", days: 28, field: "duty", limitHours: (l) => l.maxDuty28Days },
  { id: "flight-28", label: "Flight 28d", days: 28, field: "flight", limitHours: (l) => l.maxFlight28Days },
  { id: "flight-365", label: "Flight 12m", days: 365, field: "flight", limitHours: (l) => l.maxFlight365Days },
]

/** A duty's minutes as a window of that kind counts them. */
export function countedMinutes(dp: DutyPeriod, field: "duty" | "flight"): number {
  return field === "duty" ? (dp.countedDutyMinutes ?? dp.dutyMinutes) : dp.flightMinutes
}

export interface LimitContributor {
  id: string
  date: string
  route: string
  /** "standby", "training", … — a flight duty is undefined. */
  kind?: DutyPeriod["dutyKind"]
  minutes: number
}

export interface LimitDetail {
  id: LimitId
  label: string
  days: number
  field: "duty" | "flight"
  limitMinutes: number
  usedMinutes: number
  remainingMinutes: number
  /** Used over the limit, 0–1+. */
  fraction: number
  /** Every logged duty counted in the window, the largest first. */
  contributors: LimitContributor[]
  /**
   * When capacity next frees up: the oldest day with time on it rolls out of
   * the window at 00:00Z `days` days after it, taking its minutes.
   */
  rollOff: { atMs: number; date: string; minutes: number } | null
  /** The chosen duty, not yet counted: what it adds, and what it leaves in the window that holds it. */
  next: { minutes: number; leavesMinutes: number } | null
  /** The tightest this window gets over the roster ahead (from tomorrow): what is left, and on which day. */
  tightestAhead: { leftMinutes: number; date: string } | null
}

/**
 * Each limit's detail as of `asOfMs`. `past` are the logged duties (what the
 * bars count), `all` the whole timeline with the rostered duties ahead, and
 * `next` the duty the page is about when it is not yet counted.
 */
export function limitDetails(
  past: readonly DutyPeriod[],
  all: readonly DutyPeriod[],
  asOfMs: number,
  next: DutyPeriod | null,
  limits: FTLLimits = DEFAULT_FTL_LIMITS,
): LimitDetail[] {
  const asOf = new Date(asOfMs)
  const today = utcDay(asOfMs)
  const pastIds = new Set(past.map((d) => d.id))
  const nextUncounted = next && !pastIds.has(next.id) ? next : null
  // The roster ahead, with the chosen duty in it even where the timeline lacks it.
  const timeline = nextUncounted && !all.some((d) => d.id === nextUncounted.id) ? [...all, nextUncounted] : [...all]
  const futureDays = [...new Set(timeline.filter((d) => dayMs(d.date) > today).map((d) => d.date))].sort()

  return LIMIT_WINDOWS.map((w) => {
    const limitMinutes = Math.round(w.limitHours(limits) * 60)
    const stats = calculateRollingStats([...past], asOf, w.days, limits)
    const usedMinutes = Math.round((w.field === "duty" ? stats.dutyHours : stats.flightHours) * 60)
    const inWindow = past.filter((d) => {
      const day = dayMs(d.date)
      return day <= today && day > today - w.days * DAY
    })
    const contributors = inWindow
      .map((d) => ({ id: d.id, date: d.date, route: d.route ?? "", kind: d.dutyKind, minutes: countedMinutes(d, w.field) }))
      .filter((c) => c.minutes > 0)
      .sort((a, b) => b.minutes - a.minutes || b.date.localeCompare(a.date))

    // The oldest day with time on it is the next to roll out.
    let rollOff: LimitDetail["rollOff"] = null
    if (contributors.length) {
      const oldest = contributors.reduce((m, c) => (c.date < m ? c.date : m), contributors[0].date)
      const minutes = contributors.filter((c) => c.date === oldest).reduce((s, c) => s + c.minutes, 0)
      rollOff = { atMs: dayMs(oldest) + w.days * DAY, date: oldest, minutes }
    }

    // The next duty: the window ending on its day, the roster before it counted.
    let nextImpact: LimitDetail["next"] = null
    if (nextUncounted) {
      const minutes = countedMinutes(nextUncounted, w.field)
      const s = calculateRollingStats(timeline, new Date(`${nextUncounted.date}T12:00:00Z`), w.days, limits)
      const used = Math.round((w.field === "duty" ? s.dutyHours : s.flightHours) * 60)
      nextImpact = { minutes, leavesMinutes: limitMinutes - used }
    }

    // The tightest the window gets on a day ahead that has a duty on it (a
    // window's sum only grows on such a day).
    let tightestAhead: LimitDetail["tightestAhead"] = null
    for (const d of futureDays) {
      if (dayMs(d) > today + 60 * DAY) break
      const s = calculateRollingStats(timeline, new Date(`${d}T12:00:00Z`), w.days, limits)
      const left = limitMinutes - Math.round((w.field === "duty" ? s.dutyHours : s.flightHours) * 60)
      if (!tightestAhead || left < tightestAhead.leftMinutes) tightestAhead = { leftMinutes: left, date: d }
    }

    return {
      id: w.id,
      label: w.label,
      days: w.days,
      field: w.field,
      limitMinutes,
      usedMinutes,
      remainingMinutes: limitMinutes - usedMinutes,
      fraction: limitMinutes > 0 ? usedMinutes / limitMinutes : 0,
      contributors,
      rollOff,
      next: nextImpact,
      tightestAhead,
    }
  })
}

/** The limits tightest first — the least headroom for its size leads. */
export function byTightness<T extends { fraction: number }>(xs: readonly T[]): T[] {
  return [...xs].sort((a, b) => b.fraction - a.fraction)
}

type ConcernState = "ok" | "caution" | "fail" | "unknown"
const CONCERN: Record<ConcernState, number> = { fail: 0, caution: 1, unknown: 1, ok: 2 }

/**
 * The order the Flight Deck lists the limits in. A limit with cause for
 * concern leads — red before amber, the tightest first (the owner's "risk
 * radar") — and the rest keep the REGULATION's order, Duty 14d, Duty 28d,
 * Flight 28d, Flight 12m. Sorted by fraction alone, a 12-month flight figure
 * at 70% of 1,000 hours led over a 14-day duty at 40% with nothing near a
 * limit, and the owner could not see why it was first.
 */
export function limitOrder<T extends { id: string }>(xs: readonly T[], stateOf: (id: string) => ConcernState | undefined, fractionOf?: (x: T) => number): T[] {
  const rank = new Map(LIMIT_WINDOWS.map((w, i) => [w.id as string, i]))
  const frac = (x: T) => fractionOf?.(x) ?? (x as unknown as { fraction?: number; progress?: number }).fraction ?? (x as unknown as { progress?: number }).progress ?? 0
  return [...xs].sort((a, b) => {
    const ca = CONCERN[stateOf(a.id) ?? "ok"]
    const cb = CONCERN[stateOf(b.id) ?? "ok"]
    if (ca !== cb) return ca - cb
    if (ca < 2) return frac(b) - frac(a)
    return (rank.get(a.id) ?? 9) - (rank.get(b.id) ?? 9)
  })
}
