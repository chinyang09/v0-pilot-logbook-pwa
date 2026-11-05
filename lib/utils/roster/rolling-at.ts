/**
 * The rolling limits at an INSTANT, to the minute — what the FDP page's
 * timeline reads at its pointer and draws as a line at any zoom.
 *
 * The window is CONTINUOUS: the `days` × 24 hours ending at the instant. A
 * duty counts by the part of it inside the window — duty pro rata from sign-on
 * to sign-off, flight as its sectors' block time — so the total climbs through
 * a duty and falls away as the duty slides out of the far end, minute by
 * minute. It used to be the pipeline's whole UTC dates, which dropped a whole
 * day's duty at a midnight: the figure jumped instead of rolling (owner, Nov
 * 2026). Every 14 consecutive calendar days lie inside some 14 × 24h window,
 * so the highest the line reaches is never below the day figure's.
 *
 * Between its breakpoints (a duty or sector starting or ending, at the near
 * end of the window or `days` later at its far end) the figure is linear, so a
 * series of the breakpoints alone draws it exactly.
 */

import { flightElapsed, type DutyBlock } from "@/lib/utils/roster/duty-timeline"

const DAY = 86_400_000

export type RollingKind = "duty14" | "duty28" | "flight28" | "flight365"

export const ROLLING_WINDOWS: Record<RollingKind, { days: number; measure: "duty" | "flight" }> = {
  duty14: { days: 14, measure: "duty" },
  duty28: { days: 28, measure: "duty" },
  flight28: { days: 28, measure: "flight" },
  flight365: { days: 365, measure: "flight" },
}

export interface RollingIndex {
  /** Duties ordered by when they END. */
  blocks: DutyBlock[]
  ends: number[]
  /** Running totals of whole duties, `[i]` = the first `i` blocks. */
  dutyPrefix: number[]
  flightPrefix: number[]
  /** The longest duty — how far either side of an instant a straddler can reach. */
  maxLen: number
}

/** Ground duties reach no limit (the pipeline counts them zero), so they are left out. */
export function createRollingIndex(blocks: readonly DutyBlock[]): RollingIndex {
  const sorted = blocks.filter((b) => b.kind !== "ground" && b.endMs > b.startMs).sort((a, b) => a.endMs - b.endMs)
  const dutyPrefix = [0]
  const flightPrefix = [0]
  let maxLen = 0
  for (const b of sorted) {
    dutyPrefix.push(dutyPrefix[dutyPrefix.length - 1] + b.countedDutyMinutes)
    flightPrefix.push(flightPrefix[flightPrefix.length - 1] + b.flightMinutes)
    maxLen = Math.max(maxLen, b.endMs - b.startMs)
  }
  return { blocks: sorted, ends: sorted.map((b) => b.endMs), dutyPrefix, flightPrefix, maxLen }
}

/** How many blocks end at or before `t`. */
function endedBy(ends: number[], t: number): number {
  let lo = 0
  let hi = ends.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (ends[mid] <= t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** How much of a duty is done at `t`: none before it, all of it after. */
export function doneAt(block: DutyBlock, measure: "duty" | "flight", t: number): number {
  if (t >= block.endMs) return measure === "duty" ? block.countedDutyMinutes : block.flightMinutes
  if (t <= block.startMs) return 0
  if (measure === "flight") return flightElapsed(block, t)
  return (block.countedDutyMinutes * (t - block.startMs)) / (block.endMs - block.startMs)
}

/** The rolling total at `t`, in minutes (fractional — round for display). */
export function rollingAt(index: RollingIndex, kind: RollingKind, t: number): number {
  const { days, measure } = ROLLING_WINDOWS[kind]
  const a = t - days * DAY
  const { blocks, ends, maxLen } = index
  const prefix = measure === "duty" ? index.dutyPrefix : index.flightPrefix
  const i0 = endedBy(ends, a)
  const i1 = endedBy(ends, t)
  // Every duty ending inside the window, whole…
  let total = prefix[i1] - prefix[i0]
  // …less what one straddling its far end had done before the window opened…
  for (let i = i0; i < blocks.length && ends[i] <= a + maxLen; i++) {
    if (blocks[i].startMs < a && ends[i] <= t) total -= doneAt(blocks[i], measure, a)
  }
  // …plus what one still running at `t` has done inside the window.
  for (let i = i1; i < blocks.length && ends[i] <= t + maxLen; i++) {
    const b = blocks[i]
    if (b.startMs >= t) continue
    total += doneAt(b, measure, t) - (b.startMs < a ? doneAt(b, measure, a) : 0)
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
 * exact when joined with straight lines: where a duty or sector starts or
 * ends, at the instant itself and `days` later, when it leaves the window.
 */
export function rollingSeries(index: RollingIndex, kind: RollingKind, from: number, to: number, extra: number[] = []): RollingPoint[] {
  const { days, measure } = ROLLING_WINDOWS[kind]
  const W = days * DAY
  const times = new Set<number>([from, to, ...extra.filter((t) => t > from && t < to)])
  const { blocks, ends } = index
  // Only a duty inside some window drawn here can bend the line.
  for (let i = endedBy(ends, from - W); i < blocks.length; i++) {
    const b = blocks[i]
    if (b.startMs > to) continue
    const marks = measure === "duty" ? [b.startMs, b.endMs] : [b.startMs, b.endMs, ...b.sectors.flatMap((s) => [s.outMs, s.inMs])]
    for (const m of marks) {
      if (m > from && m < to) times.add(m)
      if (m + W > from && m + W < to) times.add(m + W)
    }
  }
  return [...times].sort((a, b) => a - b).map((t) => ({ t, v: rollingAt(index, kind, t) }))
}
