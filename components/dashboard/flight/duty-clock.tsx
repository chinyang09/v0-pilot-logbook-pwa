"use client"

/**
 * The DUTY & FDP tile (the owner, Nov 2026): the rest before the duty and the
 * duty's FDP on one TIMELINE, the flights tile's strip — the rest up to the
 * report, the duty from report to off duty with its legs, and its Reg 14
 * MAXIMUM drawn on the same axis as a dotted outline with a mark where it
 * ends — then three figures under it. It tracks the FDP itself; the limits
 * tile keeps the four rolling limits.
 *
 * | | Headline | The three figures |
 * |---|---|---|
 * | on duty | the duty's own line ("Sector 2 of 3") | FDP left · FDP / max · latest on-blocks |
 * | off duty, a duty ahead | "Legal from …", "Rest short by …" | rest / its minimum · report · FDP planned / max |
 * | off duty, nothing ahead | "Legal now" | rest / its minimum · legal from |
 * | a later duty chosen | its report | rest before it · report · FDP planned / max |
 *
 * A standby, or nothing known at all, keeps the duty band (`DutyBand`): a
 * standby has no FDP to draw.
 *
 * Dark cockpit: nominal is ink. A rest short of its minimum is red from the
 * report to legal; an FDP past its maximum is red past the mark.
 */

import { cn } from "@/lib/utils"
import { dutyWindow, formatDutyClock, formatRestSpan, restMinimumText } from "@/lib/utils/dashboard/duty-status"
import { fdpMinutesOf } from "@/lib/utils/roster/fdp-calculator"
import type { DutyClockInput } from "@/lib/utils/dashboard/duty-clock"
import { DutyBand, Scale, TONE, type Ramp } from "./instruments"
import type { FlightBrief } from "./model"
import type { RequirementState } from "@/lib/utils/dashboard/legality"

const MIN = 60_000
/** "Wed, 18 Nov" → "18 Nov": a caption has no room for the weekday. */
const shortDayOf = (d: string) => d.replace(/^\w+,?\s*/, "")

interface DutyClockView {
  state: string
  stateTone: "current" | "warning" | "action_required" | "getting_started"
  headline: string
  input: DutyClockInput
  slots: Array<{ value: string; label: string; live?: boolean; tone?: Ramp }>
  tone: RequirementState | null
}

/**
 * A reported delay that eats into the FDP maximum, said as the tile's line
 * (the owner, Nov 2026: react to real-time changes, and grab attention only
 * where it belongs): past the latest IN in red, within the hour of it in
 * amber. Only a LIVE estimate speaks — the schedule alone is the FDP figure's.
 */
export function estimateConcern(brief: FlightBrief, latestMs: number): { headline: string; tone: "fail" | "caution" } | null {
  const e = brief.duty.estimate
  if (!e || e.kind === "scheduled") return null
  const room = Math.round((latestMs - e.ms) / MIN)
  if (room < 0) return { headline: `Est. IN ${formatDutyClock(-room)} past max`, tone: "fail" }
  if (room < 60) return { headline: `Est. IN ${formatDutyClock(room)} to max`, tone: "caution" }
  return null
}

/** What the tile draws, or null where the duty band says it better (standby, nothing known). */
export function dutyClockView(brief: FlightBrief): DutyClockView | null {
  const { status, duty, now, clock, day } = brief
  const { phase, active, next, rest, standby } = status.duty
  // Each leg where it is now expected (`estimateDutyIn`): a delay the
  // sources report moves the bars toward the maximum's mark as it happens.
  const est = duty.estimate
  const legs = duty.times.map((t, i) => {
    const e = est?.legs[i]
    const flown = !!duty.legs[i]?.inTime
    return {
      departMs: !flown && e?.outMs != null ? e.outMs : t.departMs,
      arriveMs: !flown && e?.inMs != null ? e.inMs : t.arriveMs,
      flown,
    }
  })
  const lastArrive = legs.reduce<number | null>((m, l) => (l.arriveMs !== null && (m === null || l.arriveMs > m) ? l.arriveMs : m), null)
  const stateTone = status.dutyState

  /* A STANDBY, in progress or ahead: its window — no FDP (para 14 never
     applied to it), the rest before it where it has one. */
  if (duty.standby) {
    const sb = duty.standby
    const len = Math.round((sb.endMs - sb.startMs) / MIN)
    const r = duty.period?.restBefore ?? null
    const restStart = r ? sb.startMs - r.restMinutes * MIN : null
    const short = !sb.current && r ? !r.compliant : false
    const left = Math.max(0, Math.round((sb.endMs - now) / MIN))
    return {
      state: sb.current ? `On ${sb.code}` : duty.index === 0 ? `Next ${sb.code}` : duty.index < 0 ? `Past ${sb.code}` : `Later ${sb.code}`,
      stateTone: short ? "action_required" : "current",
      headline: short
        ? `Rest short by ${formatDutyClock(r!.requiredRestMinutes - r!.restMinutes)}`
        : sb.current
          ? "Not called"
          : `From ${clock(sb.startMs)} ${shortDayOf(day(sb.startMs))}`,
      input: {
        nowMs: now,
        rest: !sb.current && r && restStart !== null ? { startMs: restStart, legalMs: restStart + r.requiredRestMinutes * MIN } : null,
        // In progress, the part already stood is filled (to now).
        duty: { reportMs: sb.startMs, fdpStartMs: sb.startMs, fdpEndMs: sb.current ? Math.min(now, sb.endMs) : sb.startMs, endMs: sb.endMs, maxFdpMinutes: 0 },
        legs: [],
      },
      slots: [
        { value: clock(sb.startMs), label: `From ${shortDayOf(day(sb.startMs))}` },
        sb.current
          ? { value: formatDutyClock(left), label: "Left", live: true }
          : { value: formatDutyClock(len), label: "Length" },
        { value: clock(sb.endMs), label: "Until" },
      ],
      tone: short ? "fail" : null,
    }
  }

  /* A later duty, or one already flown, chosen on the timeline. */
  if (duty.index !== 0 && duty.period) {
    const dp = duty.period
    const w = dutyWindow(dp)
    if (!w) return null
    const planned = fdpMinutesOf(dp)
    const r = dp.restBefore
    const restStart = r ? w.startMs - r.restMinutes * MIN : null
    const short = r ? !r.compliant : false
    const over = dp.maxFdpMinutes > 0 && planned > dp.maxFdpMinutes
    return {
      state: duty.index < 0 ? "Past Duty" : "Later Duty",
      stateTone: short || over ? "action_required" : "current",
      headline: short ? `Rest short by ${formatDutyClock(r!.requiredRestMinutes - r!.restMinutes)}` : `Report ${day(w.startMs)}`,
      input: {
        nowMs: now,
        rest: r && restStart !== null ? { startMs: restStart, legalMs: restStart + r.requiredRestMinutes * MIN } : null,
        duty: { reportMs: w.startMs, fdpStartMs: w.startMs, fdpEndMs: w.startMs + planned * MIN, endMs: w.endMs, maxFdpMinutes: dp.maxFdpMinutes },
        legs,
      },
      slots: [
        r
          ? { value: formatRestSpan(r.restMinutes), label: `Min ${formatDutyClock(r.requiredRestMinutes)}`, tone: short ? "fail" : undefined }
          : { value: "—", label: "Rest" },
        { value: clock(w.startMs), label: `Report ${shortDayOf(day(w.startMs))}` },
        {
          value: `${formatDutyClock(planned)}${dp.maxFdpMinutes > 0 ? `/${formatDutyClock(dp.maxFdpMinutes)}` : ""}`,
          label: "FDP / Max",
          tone: over ? "fail" : undefined,
        },
      ],
      tone: short || over ? "fail" : null,
    }
  }

  const tone = stateTone === "action_required" ? "fail" : stateTone === "warning" ? "caution" : null
  /* On duty: the FDP against its maximum. */
  if (phase === "on_duty" && active) {
    if (active.maxFdpMinutes <= 0) return null
    const fdpOpen = active.startMs - (active.fdpElapsedMinutes - active.elapsedMinutes) * MIN
    const left = Math.max(0, active.maxFdpMinutes - active.fdpElapsedMinutes)
    const late = estimateConcern(brief, fdpOpen + active.maxFdpMinutes * MIN)
    return {
      state: "On Duty",
      stateTone: late && stateTone === "current" ? (late.tone === "fail" ? "action_required" : "warning") : stateTone,
      headline: late && stateTone === "current" ? late.headline : status.dutyAction.headline,
      input: {
        nowMs: now,
        rest: null,
        duty: {
          reportMs: active.startMs,
          fdpStartMs: fdpOpen,
          fdpEndMs: Math.max(active.endMs, est?.ms ?? lastArrive ?? 0),
          endMs: Math.max(active.debriefMs, (lastArrive ?? 0) + 30 * MIN),
          maxFdpMinutes: active.maxFdpMinutes,
        },
        legs,
      },
      slots: [
        { value: formatDutyClock(left), label: active.exceeded ? "FDP Over" : "FDP Left", live: true, tone: active.exceeded ? "fail" : undefined },
        { value: `${formatDutyClock(active.fdpElapsedMinutes)}/${formatDutyClock(active.maxFdpMinutes)}`, label: "FDP / Max", live: true },
        { value: clock(fdpOpen + active.maxFdpMinutes * MIN), label: "Latest IN" },
      ],
      tone: tone ?? late?.tone ?? null,
    }
  }

  if (standby) return null

  /* Off duty, the next duty ahead: the rest worked back from its report. */
  if (next && next.restRequiredMinutes > 0) {
    const restStart = next.reportMs - next.restAvailableMinutes * MIN
    const legal = restStart + next.restRequiredMinutes * MIN
    const short = next.legalAtReport === false
    const w = duty.period ? dutyWindow(duty.period) : null
    const fdpEnd = next.reportMs + next.plannedFdpMinutes * MIN
    const over = next.maxFdpMinutes > 0 && next.plannedFdpMinutes > next.maxFdpMinutes
    // A delay reported before the report: the duty now runs into its maximum.
    const late = next.maxFdpMinutes > 0 && duty.index === 0 ? estimateConcern(brief, next.reportMs + next.maxFdpMinutes * MIN) : null
    const quiet = stateTone === "current" && !over
    return {
      state: phase === "post_duty" ? "Duty Complete" : "Off Duty",
      stateTone: late && quiet ? (late.tone === "fail" ? "action_required" : "warning") : stateTone,
      headline: late && quiet ? late.headline : status.dutyAction.headline,
      input: {
        nowMs: now,
        rest: { startMs: restStart, legalMs: legal },
        duty: {
          reportMs: next.reportMs,
          fdpStartMs: next.reportMs,
          fdpEndMs: est && duty.index === 0 ? est.ms : (lastArrive ?? fdpEnd),
          endMs: w?.endMs ?? fdpEnd + 30 * MIN,
          maxFdpMinutes: next.maxFdpMinutes,
        },
        legs,
      },
      slots: [
        {
          value: formatRestSpan(next.restAvailableMinutes),
          label: `Min ${next.restMinimum || formatDutyClock(next.restRequiredMinutes)}`,
          tone: short ? "fail" : undefined,
        },
        { value: clock(next.reportMs), label: `Report ${shortDayOf(day(next.reportMs))}` },
        {
          value: next.plannedFdpMinutes > 0 ? `${formatDutyClock(next.plannedFdpMinutes)}${next.maxFdpMinutes > 0 ? `/${formatDutyClock(next.maxFdpMinutes)}` : ""}` : "—",
          label: "FDP / Max",
          tone: over ? "fail" : undefined,
        },
      ],
      tone: tone ?? (over ? "fail" : null) ?? late?.tone ?? null,
    }
  }

  /* Off duty, nothing ahead: the rest to legal. */
  if (rest) {
    const restStart = now - rest.elapsedMinutes * MIN
    const legal = Date.parse(rest.legalAtUtc)
    return {
      state: phase === "post_duty" ? "Duty Complete" : "Off Duty",
      stateTone,
      headline: status.dutyAction.headline,
      input: { nowMs: now, rest: { startMs: restStart, legalMs: Number.isFinite(legal) ? legal : now }, duty: null, legs: [] },
      slots: [
        { value: formatRestSpan(rest.elapsedMinutes), label: `Min ${restMinimumText(rest)}`, live: true },
        ...(rest.isLegalNow ? [] : [{ value: clock(legal), label: "Legal From" }]),
      ],
      tone,
    }
  }
  return null
}

/**
 * The tile: the state and its line, the three figures (the timeline over the
 * page draws the strip). It fits its SIZE (a face's — columns in thirds of a
 * phone's row, rows in the old grid's): half a phone's row has room for two
 * of the figures, a third for one; one short row sets the line smaller.
 */
export function DutyClockFace({ brief, inCard = false, size }: { brief: FlightBrief; inCard?: boolean; size?: { cols: number; rows: number } }) {
  const view = dutyClockView(brief)
  if (!view) return <DutyBand status={brief.status} now={brief.now} display={brief.display} />
  const t = TONE[view.stateTone]
  const lit = view.stateTone === "action_required" ? "text-destructive" : view.stateTone === "warning" ? "text-status-warning" : "text-foreground"
  const cols = inCard ? 3 : (size?.cols ?? 3)
  const short = !inCard && (size?.rows ?? 1) < 0.75
  const figures = cols >= 2.5 ? 3 : cols >= 1.25 ? 2 : 1
  // Narrower than a phone's row the captions are one word: "Rest", "Report".
  const slots = view.slots.slice(0, figures).map((sl) => (cols >= 2.5 ? sl : { ...sl, label: compactCaption(sl.label) }))
  return (
    <section aria-label="Duty and FDP">
      {/* The maximum is not said up here as well: the FDP / Max figure below carries it. */}
      <p className={cn("flex items-center gap-1.5 truncate text-[10px] font-bold uppercase tracking-[0.14em]", t.text)} data-morph="duty-state">
        {view.state}
      </p>
      {/* The reason, in its colour (dark cockpit: ink when all is well). */}
      <p
        className={cn(
          "truncate font-semibold tracking-tight",
          short || cols < 2.5 ? "mt-0.5 text-[16px] leading-[1.15]" : "mt-1 text-[20px] leading-[1.15]",
          cols < 1.25 && "text-[14px]",
          lit,
        )}
        suppressHydrationWarning
        data-morph="duty-headline"
      >
        {cols < 2.5 ? compactHeadline(view.headline) : view.headline}
      </p>
      {/* In the card the three figures are rows of its table, and fly there. */}
      {!inCard && <Scale slots={slots} />}
    </section>
  )
}

/** The duty's line in fewer words, for a narrow tile: "Legal from 22:00Z" → "Legal 22:00Z". */
export function compactHeadline(text: string): string {
  return text
    .replace(/^Legal from /, "Legal ")
    .replace(/^Rest short by /, "Short ")
    .replace(/^Rest until /, "Rest ")
}

/** A figure's caption in one word, for a tile narrower than a phone's row: "Min 10:00 + night" → "Rest". */
export function compactCaption(label: string): string {
  if (/^min\b/i.test(label)) return "Rest"
  if (/^report\b/i.test(label)) return "Report"
  if (/^from\b/i.test(label)) return "From"
  if (/^fdp\s*\/\s*max/i.test(label)) return "FDP"
  return label
}

/** The tile's edge: what its figures flag. */
export function dutyTone(brief: FlightBrief): RequirementState | null {
  const v = dutyClockView(brief)
  if (v) return v.tone
  const s = brief.status.dutyState
  return s === "action_required" ? "fail" : s === "warning" ? "caution" : null
}

