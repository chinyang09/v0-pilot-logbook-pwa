/**
 * How much LATER a duty can run and still be inside every limit — the owner's
 * "if there's any delay, how much more can I fly" (Nov 2026).
 *
 * A delay stretches the duty, so it eats into:
 *
 * | | margin |
 * |---|---|
 * | FDP | the duty's Reg 14 maximum less its planned FDP (or, on duty, the latest on-blocks less the planned last on-blocks) |
 * | Duty 14d / 28d (Reg 12) | the limit less the hours in EVERY window that holds this duty — including the duties rostered after it, which a window ending later also counts |
 * | Flight 28d / 12m (Reg 107) | the same, for flight time (a delay in the air — holding — adds to it) |
 *
 * The margin is the smallest of them, named by the limit that sets it. Read
 * off the same duty periods and the same rolling sum (`calculateRollingStats`,
 * whole UTC days) the limits band uses, so the two cannot disagree.
 */

import { calculateRollingStats } from "@/lib/utils/roster/fdp-calculator"
import { DEFAULT_FTL_LIMITS, type DutyPeriod, type FTLLimits } from "@/types/entities/roster.types"

export type MarginLimit = "FDP" | "Duty 14d" | "Duty 28d" | "Flight 28d" | "Flight 12m"

export interface DelayMargin {
  /** The smallest margin, minutes, floored at 0. */
  minutes: number
  /** The limit that sets it. */
  binding: MarginLimit
  /** Every limit's margin, smallest first. */
  each: { limit: MarginLimit; minutes: number }[]
}

const DAY = 86_400_000
const dayMs = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`)

/**
 * `duty`'s margin among `duties` (the whole timeline, rostered duties ahead
 * included). `fdpMarginMinutes` is null when the duty carries no FDP maximum.
 */
export function delayMargin(
  duties: readonly DutyPeriod[],
  duty: DutyPeriod,
  fdpMarginMinutes: number | null,
  limits: FTLLimits = DEFAULT_FTL_LIMITS,
): DelayMargin | null {
  const all = duties.some((d) => d.id === duty.id) ? [...duties] : [...duties, duty]
  const start = dayMs(duty.date)
  if (!Number.isFinite(start)) return null
  // The windows that hold this duty end on its day or later; a window's sum
  // changes only on a day a duty is in, so those days are all that is read.
  const laterDays = [...new Set(all.map((d) => d.date))].filter((d) => dayMs(d) >= start).sort()
  const worst = (days: number, field: "dutyHours" | "flightHours", limitHours: number): number | null => {
    if (limitHours <= 0) return null
    let used = 0
    for (const d of laterDays) {
      if (dayMs(d) >= start + days * DAY) break
      const s = calculateRollingStats(all, new Date(`${d}T12:00:00Z`), days, limits)
      used = Math.max(used, s[field])
    }
    return Math.round((limitHours - used) * 60)
  }
  const each: { limit: MarginLimit; minutes: number | null }[] = [
    { limit: "FDP", minutes: fdpMarginMinutes },
    { limit: "Duty 14d", minutes: worst(14, "dutyHours", limits.maxDuty14Days) },
    { limit: "Duty 28d", minutes: worst(28, "dutyHours", limits.maxDuty28Days) },
    { limit: "Flight 28d", minutes: worst(28, "flightHours", limits.maxFlight28Days) },
    { limit: "Flight 12m", minutes: worst(365, "flightHours", limits.maxFlight365Days) },
  ]
  const known = each
    .filter((e): e is { limit: MarginLimit; minutes: number } => e.minutes !== null)
    .map((e) => ({ limit: e.limit, minutes: Math.max(0, e.minutes) }))
    .sort((a, b) => a.minutes - b.minutes)
  if (known.length === 0) return null
  return { minutes: known[0].minutes, binding: known[0].limit, each: known }
}

