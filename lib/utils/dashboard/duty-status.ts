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
  /** Minutes since report — the CREW DUTY period's clock. */
  elapsedMinutes: number
  /**
   * Minutes since the FLIGHT duty period opened.
   *
   * Normally identical to `elapsedMinutes`: both clocks start at report. They
   * separate only under para 10(b), where a reporting delay of 4 hours or more
   * opens the FDP window 4 hours after the ORIGINAL report — earlier than the
   * crew member actually reports — so some of it is already gone at report.
   */
  fdpElapsedMinutes: number
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
  /** The FDP end — the last on-blocks once every sector is logged. */
  endMs: number
  /**
   * When the crew member was free of ALL duties: `endMs` plus para 7(2)'s
   * post-flight checks. This is what a rest period is measured from, and what
   * "when did the duty end" means.
   */
  debriefMs: number
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
  /**
   * Whether the outstanding rest requirement is satisfied BY this duty's
   * report time.
   *
   * The question a pilot asks on the way home is not "when is my next duty" —
   * it is "will I be legal for it". A roster can be wrong, and the pilot is
   * the one who has to notice: if the answer is no, the company needs telling,
   * and there is nothing else on the screen that would say so.
   *
   * `null` when there is no rest requirement to check it against.
   */
  legalAtReport: boolean | null
  /** Minutes of rest still owed at that report time. 0 when legal. */
  restShortfallMinutes: number
  /**
   * How long the FLIGHT duty period is planned to run — report to the last
   * on-blocks, NOT to the debrief. The debrief carries para 7(2)'s 30 minutes
   * of post-flight checks, which are duty but not FDP; measuring to it
   * overstates the figure the Reg 14 maximum is compared against.
   */
  plannedFdpMinutes: number
  /** Its own Reg 14 maximum. 0 when the duty period carries none. */
  maxFdpMinutes: number
  /**
   * Rest available before this duty reports, from the moment the rest period
   * commenced.
   *
   * "Legal from" on its own says little: what a rest period has to be depends
   * on the duty it precedes as well as the one it follows — para 4 asks for 24
   * hours inclusive of a local night before a duty that touches the window of
   * circadian low. So the useful comparison is worked BACKWARDS from the next
   * duty: this much rest against that much required.
   */
  restAvailableMinutes: number
  /** What that rest has to be, for THIS duty. 0 when unknown. */
  restRequiredMinutes: number
}

/**
 * A standby in progress right now.
 *
 * Its own field rather than an `ActiveDuty`, because a standby is a duty
 * period but NOT a flight duty period: paragraph 14's tables never applied to
 * it, so there is no FDP to gauge and nothing to count down to. What a pilot
 * on standby wants is how long is left of the window — and, since an
 * un-activated standby is rest, the rest countdown carries on beneath it.
 */
export interface StandbyState {
  id: string
  date: string
  /** What to call it — "Standby" / "Airport standby". */
  code: string
  startMs: number
  endMs: number
  elapsedMinutes: number
  remainingMinutes: number
  /** True once a duty has reported inside the window (para 6(6)). */
  activated: boolean
}

export interface DutyStatus {
  phase: DutyPhase
  /** Set while `phase === "on_duty"`. */
  active: ActiveDuty | null
  /** The duty just finished, while `phase === "post_duty"`. Drives the phase. */
  justFinished: ActiveDuty | null
  /**
   * The most recent COMPLETED duty, however long ago.
   *
   * `justFinished` is nulled once the post-duty window closes, because it is
   * what decides the phase. This one is not: off duty, "what did I last fly"
   * is half of the picture, the other halves being what is next and whether
   * the rest between them is enough.
   */
  lastDuty: ActiveDuty | null
  /** The next duty on the roster, whatever the phase. */
  next: NextDuty | null
  /** `null` when there is no completed duty to rest from. */
  rest: RestState | null
  /** Set while a standby window contains `now`. Independent of `phase` — a
   *  standby that has been activated runs alongside the flight duty it became. */
  standby: StandbyState | null
}

function toActive(
  dp: DutyPeriod,
  w: DutyWindow,
  nowMs: number,
  completedLegs: number,
  inProgress: boolean,
  debriefMs?: number,
): ActiveDuty {
  const elapsed = Math.max(0, Math.floor((nowMs - w.startMs) / 60_000))
  // Para 10(b) can have the FDP window open before the crew member reports.
  const fdpElapsed = elapsed + (dp.fdpElapsedAtReport ?? 0)
  const max = dp.maxFdpMinutes > 0 ? dp.maxFdpMinutes : 0
  return {
    legs: deriveSectorLegs(dp.route, completedLegs, inProgress),
    id: dp.id,
    date: dp.date,
    route: dp.route || "",
    sectorCount: dp.sectorCount || 0,
    elapsedMinutes: elapsed,
    fdpElapsedMinutes: fdpElapsed,
    maxFdpMinutes: max,
    remainingMinutes: max > 0 ? Math.max(0, max - fdpElapsed) : 0,
    exceeded: max > 0 && fdpElapsed > max,
    fdpTable: dp.fdpTableUsed,
    augmented: Boolean(dp.augmentedCrew && dp.augmentedCrew !== "none"),
    flightMinutes: dp.flightMinutes || 0,
    startMs: w.startMs,
    endMs: w.endMs,
    debriefMs: debriefMs ?? w.endMs,
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
  /**
   * Every source of a PLAN for the day — roster duty periods and duty periods
   * projected from still-scheduled flight rows.
   *
   * This is what makes a part-flown duty read correctly. See `planFor`.
   */
  scheduleDuties: DutyPeriod[] = [],
): DutyStatus {
  const nowMs = now.getTime()

  /**
   * The PLAN covering a duty period, when the roster has one.
   *
   * `mergeDutyPeriods` prefers the logbook for today, and mid-duty the logbook
   * holds only the sectors already flown — so a two-sector day with sector one
   * in the book produced a duty that "ended" on arrival, and the dashboard fell
   * straight through to a rest countdown while the pilot was sitting in the
   * cruise on sector two. Anyone flying a four-sector day saw it three times.
   *
   * The roster knows the whole shape. A schedule duty counts as the plan for a
   * logbook duty when their windows overlap at all, which is enough: two duties
   * on one date are separated by a rest period by construction.
   */
  const planFor = (dp: DutyPeriod, w: DutyWindow): DutyPeriod | null => {
    let best: DutyPeriod | null = null
    let bestEnd = w.endMs
    for (const sched of scheduleDuties) {
      const sw = dutyWindow(sched)
      if (!sw) continue
      if (sw.startMs > w.endMs || sw.endMs < w.startMs) continue
      if (sw.endMs > bestEnd) {
        bestEnd = sw.endMs
        best = sched
      }
    }
    return best
  }

  const completedLegsOf = (dp: DutyPeriod): number => {
    if (!flightArrivals || !dp.flightIds?.length) return 0
    let n = 0
    for (const id of dp.flightIds) {
      const at = flightArrivals.get(id)
      if (at !== undefined && at <= nowMs) n += 1
    }
    return n
  }

  /**
   * When the FLIGHT duty period ended — which is not when the duty period did.
   *
   * A duty period runs to being free of all duties, so `dutyWindow` carries the
   * 30 minutes of post-flight checks para 7(2) requires. The FDP does not: it
   * ends at the last on-blocks. Keying the panel off the duty window therefore
   * left it reading "Sector 2 of 2 · 2:58 FDP left" for half an hour after the
   * aeroplane was parked and the flight logged — an FDP counting down that had
   * already finished.
   *
   * Once every sector of the duty is on blocks, that instant is the end. Until
   * then the duty is still running, however far past its planned debrief it
   * goes — an unlogged sector is not a finished one.
   */
  const fdpEndOf = (dp: DutyPeriod, planned: DutyWindow, sectors: number): number => {
    if (!flightArrivals || !dp.flightIds?.length) return planned.endMs
    let latest = -Infinity
    for (const id of dp.flightIds) {
      const at = flightArrivals.get(id)
      if (at === undefined) return planned.endMs
      if (at > latest) latest = at
    }
    // Every sector the PLAN knows about has to be accounted for, or a
    // part-flown duty would look finished at the first arrival.
    if (dp.flightIds.length < sectors) return planned.endMs
    return latest
  }

  let active: ActiveDuty | null = null
  let standby: StandbyState | null = null
  let justFinished: ActiveDuty | null = null
  let lastEndMs = -Infinity
  let next: NextDuty | null = null
  let nextReportMs = Infinity

  for (const dp of dutyPeriods) {
    const logged = dutyWindow(dp)
    if (!logged) continue

    // A standby is not a flight duty period. Left in the flight-duty search it
    // would become the ACTIVE duty carrying `maxFdpMinutes: 0`, so the panel
    // would read as a flight duty whose limit failed to compute — a dash where
    // a pilot expects a number, on a duty paragraph 14 says nothing about. It
    // gets its own band instead.
    if (dp.dutyKind === "standby") {
      if (nowMs >= logged.startMs && nowMs <= logged.endMs) {
        standby = {
          id: dp.id,
          date: dp.date,
          code: dp.standbyKind === "airport" ? "Airport standby" : "Standby",
          startMs: logged.startMs,
          endMs: logged.endMs,
          elapsedMinutes: Math.max(0, Math.floor((nowMs - logged.startMs) / 60_000)),
          remainingMinutes: Math.max(0, Math.floor((logged.endMs - nowMs) / 60_000)),
          activated: Boolean(dp.activatedAt),
        }
      }
      continue
    }

    // Where the roster runs later than the record, the duty is still in
    // progress and its PLANNED figures are the legal ones: under Reg 14 the
    // maximum FDP is set by the sectors PLANNED, not the sectors flown so far.
    const plan = planFor(dp, logged)
    const planWindow = plan ? dutyWindow(plan) : null
    const w: DutyWindow = planWindow
      ? { startMs: Math.min(logged.startMs, planWindow.startMs), endMs: planWindow.endMs }
      : logged
    const effective: DutyPeriod = plan
      ? {
          ...dp,
          // From the plan: how big the duty is and what it is allowed to be.
          debriefTime: plan.debriefTime,
          sectorCount: plan.sectorCount || dp.sectorCount,
          maxFdpMinutes: plan.maxFdpMinutes || dp.maxFdpMinutes,
          fdpTableUsed: plan.fdpTableUsed ?? dp.fdpTableUsed,
          // Travels with the maximum: both come out of the same para 10
          // evaluation, so taking one without the other would gauge the plan's
          // limit against the record's clock.
          fdpElapsedAtReport: plan.maxFdpMinutes
            ? plan.fdpElapsedAtReport
            : dp.fdpElapsedAtReport,
          route: plan.route || dp.route,
          // From the record: what has actually been flown.
          flightMinutes: dp.flightMinutes,
          flightIds: dp.flightIds,
        }
      : dp

    // The FDP ends at the last on-blocks, not at the debrief.
    const fdpEnd = fdpEndOf(dp, w, effective.sectorCount || dp.sectorCount)
    const inProgress: DutyWindow = { startMs: w.startMs, endMs: fdpEnd }

    if (nowMs >= inProgress.startMs && nowMs <= inProgress.endMs) {
      // Ties go to the LATER-starting duty: a merged overnight and the sector
      // inside it can both contain `now`, and the pilot is in the inner one.
      if (!active || w.startMs > active.startMs) {
        active = toActive(effective, inProgress, nowMs, completedLegsOf(dp), true, w.endMs)
      }
      continue
    }

    if (fdpEnd < nowMs && fdpEnd > lastEndMs) {
      lastEndMs = fdpEnd
      justFinished = toActive(
        effective,
        inProgress,
        nowMs,
        effective.sectorCount || completedLegsOf(dp),
        false,
        w.endMs,
      )
    }

    if (w.startMs > nowMs && w.startMs < nextReportMs) {
      nextReportMs = w.startMs
      next = toNextDuty(effective, w.startMs, nowMs, rest)
    }
  }

  /** Does the pipeline already describe this window? */
  const coveredByRecord = (sw: DutyWindow): boolean =>
    dutyPeriods.some((dp) => {
      const w = dutyWindow(dp)
      return w && w.startMs <= sw.endMs && w.endMs >= sw.startMs
    })

  // A plan duty the logbook has not touched at all. There are two of these and
  // both matter:
  //
  //   • the duty in progress whose first sector has not landed yet — every
  //     duty's first hour;
  //   • the duty still AHEAD. `computeFDPResult` filters to `isFlownFlight`,
  //     so a day whose sectors are all still scheduled produces no duty period
  //     at all — and with no roster imported there is nothing else. The next
  //     duty was searched for only among the pipeline's duties, so a pilot
  //     with a report half an hour away read "OFF DUTY · Roster Clear · Next
  //     report —".
  for (const sched of scheduleDuties) {
    const sw = dutyWindow(sched)
    if (!sw) continue
    if (coveredByRecord(sw)) continue

    if (nowMs >= sw.startMs && nowMs <= sw.endMs) {
      if (!active || sw.startMs > active.startMs) {
        active = toActive(sched, sw, nowMs, 0, true, sw.endMs)
      }
      continue
    }

    if (sw.startMs > nowMs && sw.startMs < nextReportMs) {
      nextReportMs = sw.startMs
      next = toNextDuty(sched, sw.startMs, nowMs, rest)
    }
  }

  if (active) {
    return {
      phase: "on_duty",
      active,
      justFinished: null,
      lastDuty: justFinished,
      next,
      rest,
      standby,
    }
  }

  const recentlyFinished =
    justFinished !== null && nowMs - justFinished.endMs <= POST_DUTY_WINDOW_MS

  return {
    phase: recentlyFinished ? "post_duty" : "off",
    active: null,
    justFinished: recentlyFinished ? justFinished : null,
    // Not gated on the post-duty window: off duty, "what did I last fly" is a
    // third of the picture, alongside what is next and whether the rest
    // between them is enough.
    lastDuty: justFinished,
    next,
    rest,
    standby,
  }
}

/**
 * The next duty, with the one question that matters about it answered.
 *
 * A roster can be wrong, and a rest period that falls short of the regulation
 * is the pilot's to notice — nothing else on the screen would say so, and the
 * company needs telling while there is still time to move the duty.
 */
function toNextDuty(
  dp: DutyPeriod,
  reportMs: number,
  nowMs: number,
  rest: RestState | null,
): NextDuty {
  const legalAtMs = rest ? Date.parse(rest.legalAtUtc) : NaN
  const known = Number.isFinite(legalAtMs)
  const shortfall = known ? Math.max(0, Math.round((legalAtMs - reportMs) / 60_000)) : 0
  const w = dutyWindow(dp)

  // The FDP runs report → last on-blocks. `fdpEndTime` is that instant; a duty
  // period that predates the field falls back to the window, which is the old
  // behaviour and half an hour long.
  const fdpEndMs = dp.fdpEndTime
    ? (dutyWindow({ date: dp.date, reportTime: dp.reportTime, debriefTime: dp.fdpEndTime })
        ?.endMs ?? w?.endMs)
    : w?.endMs

  // Rest commenced `requiredMinutes` before the instant it becomes legal, so
  // the span available to this duty follows without extra plumbing.
  const restStartMs = rest ? legalAtMs - rest.requiredMinutes * 60_000 : NaN

  return {
    id: dp.id,
    date: dp.date,
    route: dp.route || "",
    sectorCount: dp.sectorCount || 0,
    reportMs,
    inMinutes: Math.round((reportMs - nowMs) / 60_000),
    legalAtReport: known ? shortfall === 0 : null,
    restShortfallMinutes: shortfall,
    plannedFdpMinutes:
      fdpEndMs !== undefined && w ? Math.max(0, Math.round((fdpEndMs - w.startMs) / 60_000)) : 0,
    maxFdpMinutes: dp.maxFdpMinutes || 0,
    restAvailableMinutes: Number.isFinite(restStartMs)
      ? Math.max(0, Math.round((reportMs - restStartMs) / 60_000))
      : 0,
    restRequiredMinutes: rest?.requiredMinutes ?? 0,
  }
}

/** "5:42" — an elapsed/remaining clock. Hours are not padded; minutes are. */
export function formatDutyClock(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes))
  return `${Math.floor(safe / 60)}:${(safe % 60).toString().padStart(2, "0")}`
}
