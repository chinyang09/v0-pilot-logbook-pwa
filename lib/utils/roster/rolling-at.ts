/**
 * The rolling limits at an INSTANT, to the minute — what the FDP page's
 * timeline reads at its pointer and draws as a line at any zoom.
 *
 * The window is the pipeline's (`calculateRollingStats`): the `days` whole UTC
 * dates ending on the instant's UTC date, a duty belonging to the date it is
 * keyed on. What an instant adds is the duty IN PROGRESS: it counts only the
 * part already done — duty pro rata from sign-on to sign-off, flight as its
 * sectors' block time — so the total climbs through a duty instead of jumping
 * by the whole of it at midnight. Once a duty has ended the figure is the
 * pipeline's own, which is what makes the two agree at every day's end.
 *
 * Between its breakpoints (a duty or sector starting or ending, a date leaving
 * the window at midnight) the figure is linear, so a series of the
 * breakpoints alone draws it exactly.
 */

import { flightElapsed, type DutyBlock } from "@/lib/utils/roster/duty-timeline"

const MIN = 60_000
const DAY = 86_400_000

export type RollingKind = "duty14" | "duty28" | "flight28" | "flight365"

export const ROLLING_WINDOWS: Record<RollingKind, { days: number; measure: "duty" | "flight" }> = {
  duty14: { days: 14, measure: "duty" },
  duty28: { days: 28, measure: "duty" },
  flight28: { days: 28, measure: "flight" },
  flight365: { days: 365, measure: "flight" },
}

const dayOf = (dateIso: string) => Math.floor(Date.parse(`${dateIso}T00:00:00Z`) / DAY)

interface Entry {
  block: DutyBlock
  day: number
}

export interface RollingIndex {
  entries: Entry[]
  /** Sorted day numbers, each with the running totals up to and including it. */
  days: number[]
  dutyPrefix: number[]
  flightPrefix: number[]
  byDay: Map<number, Entry[]>
}

/** Ground duties reach no limit (the pipeline counts them zero), so they are left out. */
export function createRollingIndex(blocks: readonly DutyBlock[]): RollingIndex {
  const entries: Entry[] = blocks.filter((b) => b.kind !== "ground" && b.date).map((block) => ({ block, day: dayOf(block.date) }))
  const byDay = new Map<number, Entry[]>()
  for (const e of entries) {
    const list = byDay.get(e.day)
    if (list) list.push(e)
    else byDay.set(e.day, [e])
  }
  const days = [...byDay.keys()].sort((a, b) => a - b)
  const dutyPrefix: number[] = []
  const flightPrefix: number[] = []
  let duty = 0
  let flight = 0
  for (const d of days) {
    for (const e of byDay.get(d)!) {
      duty += e.block.countedDutyMinutes
      flight += e.block.flightMinutes
    }
    dutyPrefix.push(duty)
    flightPrefix.push(flight)
  }
  return { entries, days, dutyPrefix, flightPrefix, byDay }
}

/** Index of the last day ≤ `day`, or −1. */
function lastAtOrBefore(days: number[], day: number): number {
  let lo = 0
  let hi = days.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (days[mid] <= day) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

function doneAt(block: DutyBlock, measure: "duty" | "flight", t: number): number {
  if (t >= block.endMs) return measure === "duty" ? block.countedDutyMinutes : block.flightMinutes
  if (t <= block.startMs) return 0
  if (measure === "flight") return flightElapsed(block, t)
  return (block.countedDutyMinutes * (t - block.startMs)) / (block.endMs - block.startMs)
}

/** How long a duty can run past its own date and still be in progress. */
const SPILL_DAYS = 3

/** The rolling total at `t`, in minutes (fractional — round for display). */
export function rollingAt(index: RollingIndex, kind: RollingKind, t: number): number {
  const { days: span, measure } = ROLLING_WINDOWS[kind]
  const asOf = Math.floor(t / DAY)
  const prefix = measure === "duty" ? index.dutyPrefix : index.flightPrefix
  const hi = lastAtOrBefore(index.days, asOf)
  const lo = lastAtOrBefore(index.days, asOf - span)
  let total = (hi >= 0 ? prefix[hi] : 0) - (lo >= 0 ? prefix[lo] : 0)
  // Whole totals counted every duty in the window as finished; take back what
  // a duty still running (or not yet begun, later on the same date) has not done.
  for (let d = Math.max(asOf - SPILL_DAYS, asOf - span + 1); d <= asOf; d++) {
    for (const e of index.byDay.get(d) ?? []) {
      if (t >= e.block.endMs) continue
      const full = measure === "duty" ? e.block.countedDutyMinutes : e.block.flightMinutes
      total -= full - doneAt(e.block, measure, t)
    }
  }
  return Math.max(0, total)
}

export interface RollingPoint {
  t: number
  /** Minutes. */
  v: number
}

/**
 * The rolling total across [from, to] as the points where its slope changes —
 * exact when joined with straight lines. A date leaving the window drops the
 * total at midnight, drawn as two points a millisecond apart.
 */
export function rollingSeries(index: RollingIndex, kind: RollingKind, from: number, to: number, extra: number[] = []): RollingPoint[] {
  const { days: span, measure } = ROLLING_WINDOWS[kind]
  const times = new Set<number>([from, to, ...extra.filter((t) => t > from && t < to)])
  for (let m = Math.ceil(from / DAY) * DAY; m <= to; m += DAY) {
    if (m - 1 > from) times.add(m - 1)
    times.add(m)
  }
  // Only a duty inside some window drawn here can bend the line.
  const firstDay = Math.floor(from / DAY) - span
  const lastDay = Math.floor(to / DAY)
  for (const e of index.entries) {
    if (e.day < firstDay || e.day > lastDay) continue
    const b = e.block
    const marks = measure === "duty" ? [b.startMs, b.endMs] : [b.startMs, b.endMs, ...b.sectors.flatMap((s) => [s.outMs, s.inMs])]
    for (const t of marks) if (t > from && t < to) times.add(t)
  }
  return [...times].sort((a, b) => a - b).map((t) => ({ t, v: rollingAt(index, kind, t) }))
}
