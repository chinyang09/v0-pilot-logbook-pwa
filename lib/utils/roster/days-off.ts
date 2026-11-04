/**
 * FIFTH SCHEDULE paragraph 5 — days off, checked off the duty timeline.
 *
 *   5(1) A day off … must be at least 34 hours free of all duties including a
 *        local night and commences one hour after the crew member completes a
 *        duty period …
 *   5(3) When days off are rostered on consecutive days, each subsequent day
 *        off … must be a period of at least 24 hours and include a local night.
 *   5(4) … (a) does not work more than 7 consecutive days between days off;
 *        (b) is rostered to have at least 2 days off every 2 consecutive weeks;
 *        (c) has at least 8 days off every 4 consecutive weeks except that a
 *            minimum of 6 days off in a consecutive 4-week period is
 *            permissible if the shortfall … has been or will be made good in
 *            the preceding or following consecutive 4-week period.
 *   5(5) When a crew member has been away from home base for any period of 7
 *        days or more, a period of at least 82 hours (including 3 local
 *        nights) at home base must be provided … before the start of the next
 *        flight duty period.
 *
 * Read off the same blocks the timeline draws, so a warning and the picture
 * cannot disagree. Three rules keep it from crying wolf:
 *
 * - **Only BETWEEN known duties.** Days off are found in the gaps between
 *   duties the app knows about. Missing data reads as free time, so it can
 *   only ever produce a day off, never take one away — and every window is
 *   judged only inside the span the duties cover, where that is true.
 * - **Standby is a duty here.** The owner's ruling that an un-called home
 *   standby is REST governs para 3; a day on standby is still not a day off,
 *   which is "free of all duties" and is rostered as such.
 * - **Local nights in Singapore time**, as for every rest period (the owner's
 *   ruling) — a day off is "an extended rest period".
 *
 * 5(6) (a disrupted flight may cut the ensuing day off by 4 hours if made up)
 * is not modelled: whether a disruption was unforeseen is not in the record.
 */

import type { DutyBlock } from "@/lib/utils/roster/duty-timeline"
import {
  countsConsecutiveLocalNights,
  earliestLocalNightCompletion,
  REST_STARTS_AFTER_DUTY_MIN,
} from "@/lib/utils/roster/regulation-definitions"

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/** Where days off and local nights are read: Singapore. */
const SGT_MIN = 8 * 60

export const DAY_OFF_MIN_HOURS = 34
export const SUBSEQUENT_DAY_OFF_HOURS = 24
export const MAX_CONSECUTIVE_WORK_DAYS = 7
export const RETURN_REST_HOURS = 82
export const RETURN_REST_NIGHTS = 3
export const AWAY_TRIGGER_DAYS = 7

/** Home base, by either code. */
export const DEFAULT_HOME_BASE = ["WSSS", "SIN"]

export interface DayOff {
  startMs: number
  endMs: number
}

export type DaysOffRule = "5(4)(a)" | "5(4)(b)" | "5(4)(c)" | "5(5)"

export interface DaysOffFinding {
  rule: DaysOffRule
  /** `violation` breaks the paragraph; `caution` depends on a make-good the record cannot show. */
  severity: "violation" | "caution"
  /** Where on the timeline it applies — what a tap brings to the pointer. */
  atMs: number
  /** One line for the list. */
  label: string
}

export interface DaysOffResult {
  daysOff: DayOff[]
  findings: DaysOffFinding[]
}

/** The SGT calendar day an instant falls on, as a day number. */
const sgtDay = (ms: number) => Math.floor((ms + SGT_MIN * MIN) / DAY)
/** Midnight SGT that opens a day number, as an instant. */
const sgtMidnight = (day: number) => day * DAY - SGT_MIN * MIN

/**
 * The days off a free interval holds, earliest first: the first once 34 hours
 * including a local night have passed, each after it once another 24 hours
 * including a local night have.
 */
export function daysOffIn(freeFromMs: number, freeUntilMs: number): DayOff[] {
  const out: DayOff[] = []
  if (!(freeUntilMs > freeFromMs)) return out
  let end = freeFromMs + DAY_OFF_MIN_HOURS * HOUR
  // Any 34 hours holds a full 2200–0800 window, so the first local night is
  // already in; checked all the same rather than assumed.
  const firstNight = earliestLocalNightCompletion(freeFromMs, SGT_MIN)
  if (firstNight !== null) end = Math.max(end, firstNight)
  let start = freeFromMs
  while (end <= freeUntilMs) {
    out.push({ startMs: start, endMs: end })
    start = end
    const night = earliestLocalNightCompletion(end, SGT_MIN)
    end = Math.max(end + SUBSEQUENT_DAY_OFF_HOURS * HOUR, night ?? Infinity)
  }
  return out
}

/** The airport a duty ends at, when the block says. */
function endsAt(b: DutyBlock): string | null {
  const last = b.sectors[b.sectors.length - 1]
  if (last?.to) return last.to.toUpperCase()
  const fromRoute = b.route.split("-").pop()?.trim()
  return fromRoute ? fromRoute.toUpperCase() : null
}

/** Midday SGT of a day — the same calendar date in UTC and in Singapore. */
const sgtMidday = (day: number) => sgtMidnight(day) + 12 * HOUR

export function analyseDaysOff(
  blocks: readonly DutyBlock[],
  options: { homeBase?: readonly string[] } = {},
): DaysOffResult {
  const homeBase = new Set((options.homeBase ?? DEFAULT_HOME_BASE).map((c) => c.toUpperCase()))
  const duties = blocks
    .filter((b) => b.endMs > b.startMs)
    .slice()
    .sort((a, b) => a.startMs - b.startMs)
  const findings: DaysOffFinding[] = []
  if (duties.length === 0) return { daysOff: [], findings }

  // Duty time as merged intervals — two overlapping records are one stretch.
  const busy: { startMs: number; endMs: number; blocks: DutyBlock[] }[] = []
  for (const b of duties) {
    const last = busy[busy.length - 1]
    if (last && b.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, b.endMs)
      last.blocks.push(b)
    } else busy.push({ startMs: b.startMs, endMs: b.endMs, blocks: [b] })
  }

  // 5(1)/(3): the days off in each gap, which commence an hour after the duty.
  const daysOff: DayOff[] = []
  const gapDaysOff: number[] = []
  for (let i = 0; i + 1 < busy.length; i++) {
    const found = daysOffIn(busy[i].endMs + REST_STARTS_AFTER_DUTY_MIN * MIN, busy[i + 1].startMs)
    daysOff.push(...found)
    gapDaysOff.push(found.length)
  }

  // 5(4)(a): days worked — SGT dates touched by duty — between days off.
  let worked = new Set<number>()
  let flagged = false
  for (let i = 0; i < busy.length; i++) {
    for (let d = sgtDay(busy[i].startMs); d <= sgtDay(busy[i].endMs - 1); d++) {
      worked.add(d)
      if (!flagged && worked.size > MAX_CONSECUTIVE_WORK_DAYS) {
        flagged = true
        const at = Math.max(busy[i].startMs, sgtMidnight(d))
        findings.push({
          rule: "5(4)(a)",
          severity: "violation",
          atMs: at,
          label: `${worked.size} days on without a day off (max ${MAX_CONSECUTIVE_WORK_DAYS})`,
        })
      }
    }
    if (i < gapDaysOff.length && gapDaysOff[i] > 0) {
      worked = new Set()
      flagged = false
    }
  }

  // 5(4)(b)/(c): rolling windows of SGT dates, only inside the covered span.
  // A day off belongs to the date its middle falls on.
  const firstDay = sgtDay(busy[0].startMs)
  const lastDay = sgtDay(busy[busy.length - 1].endMs)
  // Prefix counts by day, so a window is one subtraction over a career.
  const prefix = new Int32Array(lastDay - firstDay + 2)
  for (const o of daysOff) {
    const d = sgtDay((o.startMs + o.endMs) / 2)
    if (d >= firstDay && d <= lastDay) prefix[d - firstDay + 1] += 1
  }
  for (let i = 1; i < prefix.length; i++) prefix[i] += prefix[i - 1]
  const countIn = (from: number, len: number) => {
    const a = Math.max(0, Math.min(prefix.length - 1, from - firstDay))
    const b = Math.max(0, Math.min(prefix.length - 1, from + len - firstDay))
    return prefix[b] - prefix[a]
  }
  const inCover = (from: number, len: number) => from >= firstDay && from + len - 1 <= lastDay

  const rolling = (len: number, judge: (count: number, from: number) => DaysOffFinding | null) => {
    let open = false
    for (let from = firstDay; from + len - 1 <= lastDay; from++) {
      const finding = judge(countIn(from, len), from)
      if (finding && !open) findings.push(finding)
      open = finding !== null
    }
  }

  rolling(14, (count, from) =>
    count >= 2
      ? null
      : {
          rule: "5(4)(b)",
          severity: "violation",
          atMs: sgtMidday(from),
          label: `${count} day${count === 1 ? "" : "s"} off in 2 weeks (min 2)`,
        },
  )
  rolling(28, (count, from) => {
    if (count >= 8) return null
    const base = {
      rule: "5(4)(c)" as const,
      atMs: sgtMidday(from),
      label: `${count} day${count === 1 ? "" : "s"} off in 4 weeks (min 8)`,
    }
    if (count < 6) return { ...base, severity: "violation" }
    // 6 or 7 is permissible where the shortfall is made good in the 4 weeks
    // before or after — and where neither is known, it is a caution.
    const need = 8 + (8 - count)
    const before = inCover(from - 28, 28) ? countIn(from - 28, 28) : null
    const after = inCover(from + 28, 28) ? countIn(from + 28, 28) : null
    if ((before ?? 0) >= need || (after ?? 0) >= need) return null
    return { ...base, severity: before === null || after === null ? "caution" : "violation" }
  })

  // 5(5): back from 7 days or more away, 82 hours with 3 local nights at base
  // before the next flight duty period.
  let awaySince: number | null = null
  for (let i = 0; i < duties.length; i++) {
    const b = duties[i]
    const at = endsAt(b)
    if (at === null || b.kind !== "flight") continue
    if (!homeBase.has(at)) {
      if (awaySince === null) awaySince = b.startMs
      continue
    }
    if (awaySince !== null && b.endMs - awaySince >= AWAY_TRIGGER_DAYS * DAY) {
      const nextFdp = duties.slice(i + 1).find((n) => n.kind === "flight" && n.maxFdpMinutes > 0)
      if (nextFdp) {
        const freeFrom = b.endMs + REST_STARTS_AFTER_DUTY_MIN * MIN
        const nextDuty = duties.slice(i + 1).find((n) => n.kind !== "standby") ?? nextFdp
        const freeUntil = Math.min(nextDuty.startMs, nextFdp.startMs)
        const hours = (freeUntil - freeFrom) / HOUR
        const nights = countsConsecutiveLocalNights(freeFrom, freeUntil, SGT_MIN)
        if (hours < RETURN_REST_HOURS || nights < RETURN_REST_NIGHTS) {
          findings.push({
            rule: "5(5)",
            severity: "violation",
            atMs: freeUntil,
            label: `${Math.max(0, Math.floor(hours))}h at base after ${Math.floor((b.endMs - awaySince) / DAY)} days away (min ${RETURN_REST_HOURS}h)`,
          })
        }
      }
    }
    awaySince = null
  }

  findings.sort((a, b) => a.atMs - b.atMs)
  return { daysOff, findings }
}
