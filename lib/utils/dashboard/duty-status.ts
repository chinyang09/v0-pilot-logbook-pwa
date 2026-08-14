/**
 * Where the pilot is in their duty day.
 *
 * This is the half of "can I fly" that changes minute to minute, and it is
 * deliberately separate from `legality.ts`: that module answers "do I meet the
 * standing requirements", this one answers "what is happening right now".
 * Together they are the legal dashboard.
 *
 * **The FDP maximum is NEVER hardcoded here.** Under CAAS Reg 14 (Fifth
 * Schedule) the maximum daily FDP moves with report time, sector count, crew
 * complement, acclimatisation and the long-sector adjustment — a fixed "13:00"
 * is wrong for most duties and dangerously wrong for some. `DutyPeriod` already
 * carries `maxFdpMinutes` and the `fdpTableUsed` that produced it, computed by
 * `calculateMaxFDP` when the duty period was built. This module reads that
 * number; it does not invent one, and it surfaces the table so the figure can
 * be checked rather than trusted.
 *
 * Pure: no React, no Dexie, no clock beyond the `now` handed in.
 */

import type { DutyPeriod } from "@/types/entities/roster.types"
import { hhmmToMinutes } from "@/lib/utils/time"

/**
 * What the dashboard is looking at.
 *
 * `post_duty` is not a separate regulatory state — it is the window straight
 * after a debrief where the pilot's next question changes from "how much have I
 * got left" to "when may I go again", so the panel leads with the rest
 * countdown instead of an FDP meter that has stopped moving.
 */
export type DutyPhase = "off" | "on_duty" | "post_duty"

/** How long after debrief the dashboard still leads with the duty just flown. */
export const POST_DUTY_WINDOW_MS = 3 * 60 * 60 * 1000

export interface DutyWindow {
  startMs: number
  endMs: number
}

/**
 * A duty period's absolute UTC window.
 *
 * Duty period times are HH:MM in UTC (they are derived from flight OOOI, which
 * the app stores in UTC), and a debrief earlier than its report means the duty
 * crossed midnight — the same wrap `calculateRestUntilLegal` applies.
 */
export function dutyWindow(dp: Pick<DutyPeriod, "date" | "reportTime" | "debriefTime">): DutyWindow | null {
  const start = Date.parse(`${dp.date}T${(dp.reportTime || "").slice(0, 5)}:00Z`)
  if (!Number.isFinite(start)) return null

  const reportMin = hhmmToMinutes(dp.reportTime)
  const debriefMin = hhmmToMinutes(dp.debriefTime)
  const wraps = debriefMin < reportMin
  const end = start + ((wraps ? debriefMin + 1440 : debriefMin) - reportMin) * 60_000
  if (!Number.isFinite(end)) return null

  return { startMs: start, endMs: end }
}

/**
 * One leg of the duty, for the sector chain.
 *
 * A duty is not one route — it is up to four sectors across several airports —
 * and "where am I in the pattern" is a question the panel could not answer
 * while it was showing a generic list of recent flights instead.
 */
export interface SectorLeg {
  from: string
  to: string
  status: "complete" | "active" | "scheduled"
}

/**
 * The airport chain a duty period records ("WSSS-VVNB-WSSS") split into legs,
 * with progress marked.
 *
 * `completed` is how many legs are already on blocks. Everything after the
 * completed ones is scheduled; the one immediately after is `active` while the
 * duty is in progress, so a four-sector day reads as a chain with the current
 * leg lit rather than as a route string nobody can locate themselves in.
 */
export function deriveSectorLegs(
  route: string | undefined,
  completed: number,
  inProgress: boolean,
): SectorLeg[] {
  const stops = (route || "")
    .split("-")
    .map((s) => s.trim())
    .filter(Boolean)
  if (stops.length < 2) return []

  const legs: SectorLeg[] = []
  for (let i = 0; i < stops.length - 1; i++) {
    legs.push({
      from: stops[i],
      to: stops[i + 1],
      status:
        i < completed ? "complete" : i === completed && inProgress ? "active" : "scheduled",
    })
  }
  return legs
}

export interface ActiveDuty {
  id: string
  date: string
  route: string
  sectorCount: number
  /** Minutes since report. */
  elapsedMinutes: number
  /**
   * The CAAS Reg 14 maximum for THIS duty — report time, sectors, crew and
   * acclimatisation already applied. 0 when the duty period carries none.
   */
  maxFdpMinutes: number
  /** `maxFdpMinutes - elapsed`, floored at 0. Negative overage is reported by
   *  `exceeded` rather than as a negative remaining. */
  remainingMinutes: number
  exceeded: boolean
  /** Which CAAS table produced the maximum ("A" acclimatised, "B" not, "C"
   *  single-pilot) — so the number can be checked, not just trusted. */
  fdpTable?: string
  augmented: boolean
  /** Block minutes flown in this duty so far. */
  flightMinutes: number
  /** The duty's legs, with progress. Empty when the duty records no route. */
  legs: SectorLeg[]
  startMs: number
  endMs: number
}

/**
 * Rest since the last debrief, which belongs to the DUTY panel rather than the
 * currency grid: it is a property of the duty just flown, not a standing
 * qualification, and among a column of expiry dates a live countdown read as a
 * different kind of thing entirely — because it is one.
 */
export interface RestState {
  isLegalNow: boolean
  elapsedMinutes: number
  requiredMinutes: number
  /** ISO instant the pilot becomes legal. Only meaningful while not legal. */
  legalAtUtc: string
}

export interface NextDuty {
  id: string
  date: string
  route: string
  sectorCount: number
  reportMs: number
  /** Minutes from `now` until report. Negative if report has passed. */
  inMinutes: number
}

export interface DutyStatus {
  phase: DutyPhase
  /** Set while `phase === "on_duty"`. */
  active: ActiveDuty | null
  /** The duty just finished, while `phase === "post_duty"`. */
  justFinished: ActiveDuty | null
  /** The next duty on the roster, whatever the phase. */
  next: NextDuty | null
  /** `null` when there is no completed duty to rest from. */
  rest: RestState | null
}

function toActive(
  dp: DutyPeriod,
  w: DutyWindow,
  nowMs: number,
  completedLegs: number,
  inProgress: boolean,
): ActiveDuty {
  const elapsed = Math.max(0, Math.floor((nowMs - w.startMs) / 60_000))
  const max = dp.maxFdpMinutes > 0 ? dp.maxFdpMinutes : 0
  return {
    legs: deriveSectorLegs(dp.route, completedLegs, inProgress),
    id: dp.id,
    date: dp.date,
    route: dp.route || "",
    sectorCount: dp.sectorCount || 0,
    elapsedMinutes: elapsed,
    maxFdpMinutes: max,
    remainingMinutes: max > 0 ? Math.max(0, max - elapsed) : 0,
    exceeded: max > 0 && elapsed > max,
    fdpTable: dp.fdpTableUsed,
    augmented: Boolean(dp.augmentedCrew && dp.augmentedCrew !== "none"),
    flightMinutes: dp.flightMinutes || 0,
    startMs: w.startMs,
    endMs: w.endMs,
  }
}

/**
 * Which duty the pilot is in, has just left, or is heading for.
 *
 * A duty is "active" when now falls inside its absolute window. Scheduled
 * duties count: a roster's duty that has started is the one being flown, and
 * waiting for logbook entries to appear would leave the panel blank for exactly
 * the hours it is most wanted.
 */
export function deriveDutyStatus(
  dutyPeriods: DutyPeriod[],
  now: Date = new Date(),
  /**
   * Rest since the last debrief, from `calculateRestUntilLegal`. Passed in
   * rather than recomputed: that calculation walks every duty period and the
   * FDP pipeline has already done it.
   */
  rest: RestState | null = null,
  /** Flight id → on-blocks instant, for marking sector progress. */
  flightArrivals?: Map<string, number>,
): DutyStatus {
  const nowMs = now.getTime()

  const completedLegsOf = (dp: DutyPeriod): number => {
    if (!flightArrivals || !dp.flightIds?.length) return 0
    let n = 0
    for (const id of dp.flightIds) {
      const at = flightArrivals.get(id)
      if (at !== undefined && at <= nowMs) n += 1
    }
    return n
  }

  let active: ActiveDuty | null = null
  let justFinished: ActiveDuty | null = null
  let lastEndMs = -Infinity
  let next: NextDuty | null = null
  let nextReportMs = Infinity

  for (const dp of dutyPeriods) {
    const w = dutyWindow(dp)
    if (!w) continue

    if (nowMs >= w.startMs && nowMs <= w.endMs) {
      // Ties go to the LATER-starting duty: a merged overnight and the sector
      // inside it can both contain `now`, and the pilot is in the inner one.
      if (!active || w.startMs > active.startMs) {
        active = toActive(dp, w, nowMs, completedLegsOf(dp), true)
      }
      continue
    }

    if (w.endMs < nowMs && w.endMs > lastEndMs) {
      lastEndMs = w.endMs
      justFinished = toActive(dp, w, nowMs, dp.sectorCount || completedLegsOf(dp), false)
    }

    if (w.startMs > nowMs && w.startMs < nextReportMs) {
      nextReportMs = w.startMs
      next = {
        id: dp.id,
        date: dp.date,
        route: dp.route || "",
        sectorCount: dp.sectorCount || 0,
        reportMs: w.startMs,
        inMinutes: Math.round((w.startMs - nowMs) / 60_000),
      }
    }
  }

  if (active) return { phase: "on_duty", active, justFinished: null, next, rest }

  const recentlyFinished =
    justFinished !== null && nowMs - justFinished.endMs <= POST_DUTY_WINDOW_MS

  return {
    phase: recentlyFinished ? "post_duty" : "off",
    active: null,
    justFinished: recentlyFinished ? justFinished : null,
    next,
    rest,
  }
}

/** "5:42" — an elapsed/remaining clock. Hours are not padded; minutes are. */
export function formatDutyClock(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes))
  return `${Math.floor(safe / 60)}:${(safe % 60).toString().padStart(2, "0")}`
}
