/**
 * The Flight Deck's TIMELINE (the owner, Nov 2026: "a working timeline,
 * similar to that of FDP, but … the look of the timeline we have now. So we
 * can scroll and select a duty. And the widgets all work around the
 * scrollable timeline … Limits also change as we scroll").
 *
 * Pure, on instants, so what the pointer selects and what the limits read at
 * it are tested without the page (`deck-timeline.test.ts`).
 *
 * | | Rule |
 * |---|---|
 * | the duty selected | the one the pointer is INSIDE (the later-starting where two overlap), else the next to start after it — between duties the pilot is resting FOR the next one — else the last |
 * | the limits | the four rolling limits at the pointer's instant, CONTINUOUS windows (`rollingAt`, the FDP page's): a duty counts by the part of it inside the window, so the figures roll minute by minute as the timeline is scrolled, and ahead of now they are the roster's forecast |
 * | the range drawn | 90 days back to 120 ahead of now, at most — a career's logbook is not a strip to scroll through |
 */

import { rollingAt, type RollingIndex, type RollingKind } from "@/lib/utils/roster/rolling-at"
import { LIMIT_WINDOWS, type LimitId } from "@/lib/utils/dashboard/limit-detail"
import { DEFAULT_FTL_LIMITS, type FTLLimits } from "@/types/entities/roster.types"

const H = 3_600_000
const DAY = 24 * H

export interface Selectable {
  id: string
  startMs: number
  endMs: number
}

/**
 * The duty the pointer at `t` selects, from `blocks` in time order: the one it
 * is inside (the later-starting wins, as the FDP pipeline's active duty
 * does), else the next to start, else the last. Null with none.
 */
export function selectAt(blocks: readonly Selectable[], t: number): string | null {
  let inside: Selectable | null = null
  let next: Selectable | null = null
  for (const b of blocks) {
    if (b.startMs <= t) {
      if (t < b.endMs) inside = b
    } else if (!next || b.startMs < next.startMs) next = b
  }
  if (inside) return inside.id
  if (next) return next.id
  return blocks.length ? blocks[blocks.length - 1].id : null
}

/** A limit as the pointer reads it. */
export interface LimitAt {
  id: LimitId
  label: string
  days: number
  limitMinutes: number
  usedMinutes: number
  remainingMinutes: number
  fraction: number
  /** Dark cockpit: nothing while there is room, amber from `LIMIT_CAUTION_SHARE`, red at the limit. */
  state: "ok" | "caution" | "fail"
}

/** The share of a limit that turns it amber — the legality model's. */
export const LIMIT_CAUTION_SHARE = 0.8

const KIND: Record<LimitId, RollingKind> = {
  "duty-14": "duty14",
  "duty-28": "duty28",
  "flight-28": "flight28",
  "flight-365": "flight365",
}

/** The four rolling limits at `t`, in the regulation's order. */
export function limitsAt(index: RollingIndex, t: number, limits: FTLLimits = DEFAULT_FTL_LIMITS): LimitAt[] {
  return LIMIT_WINDOWS.map((w) => {
    const limitMinutes = Math.round(w.limitHours(limits) * 60)
    const usedMinutes = Math.round(rollingAt(index, KIND[w.id], t))
    const fraction = limitMinutes > 0 ? usedMinutes / limitMinutes : 0
    return {
      id: w.id,
      label: w.label,
      days: w.days,
      limitMinutes,
      usedMinutes,
      remainingMinutes: limitMinutes - usedMinutes,
      fraction,
      state: fraction >= 1 ? "fail" : fraction >= LIMIT_CAUTION_SHARE ? "caution" : "ok",
    }
  })
}

/** The worst of the limits — the limits tile's edge. */
export function limitsTone(rows: readonly LimitAt[]): "fail" | "caution" | null {
  if (rows.some((r) => r.state === "fail")) return "fail"
  if (rows.some((r) => r.state === "caution")) return "caution"
  return null
}

/** How far back and ahead of now the timeline runs, at most. */
export const DECK_BACK_DAYS = 90
export const DECK_AHEAD_DAYS = 120

/**
 * The span the timeline draws: the duties within reach, two days either side,
 * now always inside, each end on a midnight of the display clock
 * (`midnight`: the start of the day an instant falls on).
 */
export function deckRange(
  blocks: readonly Selectable[],
  nowMs: number,
  midnight: (ms: number) => number,
): { fromMs: number; toMs: number } {
  const lo = nowMs - DECK_BACK_DAYS * DAY
  const hi = nowMs + DECK_AHEAD_DAYS * DAY
  let first = nowMs
  let last = nowMs
  for (const b of blocks) {
    if (b.endMs < lo || b.startMs > hi) continue
    first = Math.min(first, b.startMs)
    last = Math.max(last, b.endMs)
  }
  return { fromMs: midnight(Math.max(lo, first - 2 * DAY)), toMs: midnight(Math.min(hi, last + 3 * DAY)) + DAY }
}

/**
 * The hours a label goes on between two instants — every `every` hours of the
 * display clock, counted from `anchorMs` (one of its midnights, so a
 * half-hour zone's hours fall where its clock says), midnights marked.
 */
export function hourMarks(
  fromMs: number,
  toMs: number,
  anchorMs: number,
  hourOf: (ms: number) => number,
  every = 3,
): Array<{ ms: number; hour: number; midnight: boolean }> {
  const out: Array<{ ms: number; hour: number; midnight: boolean }> = []
  const first = anchorMs + Math.ceil((fromMs - anchorMs) / H) * H
  for (let ms = first; ms <= toMs; ms += H) {
    const hour = hourOf(ms)
    if (hour % every === 0) out.push({ ms, hour, midnight: hour === 0 })
  }
  return out
}
