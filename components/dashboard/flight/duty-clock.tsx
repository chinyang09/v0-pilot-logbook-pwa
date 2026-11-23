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

import * as React from "react"
import { cn } from "@/lib/utils"
import { dutyWindow, formatDutyClock, formatRestSpan, restMinimumText } from "@/lib/utils/dashboard/duty-status"
import { fdpMinutesOf } from "@/lib/utils/roster/fdp-calculator"
import { clockTicks, dutyClock, type DutyClock, type DutyClockInput } from "@/lib/utils/dashboard/duty-clock"
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

/** What the tile draws, or null where the duty band says it better (standby, nothing known). */
export function dutyClockView(brief: FlightBrief): DutyClockView | null {
  const { status, duty, now, clock, day } = brief
  const { phase, active, next, rest, standby } = status.duty
  const legs = duty.times.map((t, i) => ({ departMs: t.departMs, arriveMs: t.arriveMs, flown: !!duty.legs[i]?.inTime }))
  const lastArrive = legs.reduce<number | null>((m, l) => (l.arriveMs !== null && (m === null || l.arriveMs > m) ? l.arriveMs : m), null)
  const stateTone = status.dutyState

  /* A later duty, chosen in the header. */
  if (duty.index > 0 && duty.period) {
    const dp = duty.period
    const w = dutyWindow(dp)
    if (!w) return null
    const planned = fdpMinutesOf(dp)
    const r = dp.restBefore
    const restStart = r ? w.startMs - r.restMinutes * MIN : null
    const short = r ? !r.compliant : false
    const over = dp.maxFdpMinutes > 0 && planned > dp.maxFdpMinutes
    return {
      state: "Later Duty",
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
    return {
      state: "On Duty",
      stateTone,
      headline: status.dutyAction.headline,
      input: {
        nowMs: now,
        rest: null,
        duty: {
          reportMs: active.startMs,
          fdpStartMs: fdpOpen,
          fdpEndMs: Math.max(active.endMs, lastArrive ?? 0),
          endMs: Math.max(active.debriefMs, (lastArrive ?? 0) + 30 * MIN),
          maxFdpMinutes: active.maxFdpMinutes,
        },
        legs,
      },
      slots: [
        { value: formatDutyClock(left), label: active.exceeded ? "FDP Over" : "FDP Left", live: true, tone: active.exceeded ? "fail" : undefined },
        { value: `${formatDutyClock(active.fdpElapsedMinutes)}/${formatDutyClock(active.maxFdpMinutes)}`, label: "FDP / Max", live: true },
        { value: clock(fdpOpen + active.maxFdpMinutes * MIN), label: "Latest On-Blocks" },
      ],
      tone,
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
    return {
      state: phase === "post_duty" ? "Duty Complete" : "Off Duty",
      stateTone,
      headline: status.dutyAction.headline,
      input: {
        nowMs: now,
        rest: { startMs: restStart, legalMs: legal },
        duty: {
          reportMs: next.reportMs,
          fdpStartMs: next.reportMs,
          fdpEndMs: lastArrive ?? fdpEnd,
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
      tone: tone ?? (over ? "fail" : null),
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
 * The strip: rest, duty, legs and the maximum on one scale in time, a tick
 * each hour (three on a long one), labelled every few in the pilot's clock.
 */
export function DutyClockStrip({ clock: c, zulu }: { clock: DutyClock; zulu: boolean }) {
  const span = c.toMs - c.fromMs
  const pct = (ms: number) => `${Math.max(0, Math.min(100, ((ms - c.fromMs) / span) * 100))}%`
  const range = (a: number, b: number) => ({ left: pct(a), width: `calc(${pct(Math.max(a, b))} - ${pct(a)})` })
  const hourOf = (ms: number) => (zulu ? new Date(ms).getUTCHours() : new Date(ms).getHours())
  const ticks = clockTicks(c, hourOf)
  const { rest, duty } = c
  const over = duty && duty.maxEndMs !== null && duty.fdpEndMs > duty.maxEndMs
  return (
    <div aria-hidden className="mt-2" data-morph="duty-strip" data-morph-stretch>
      <div className="relative h-[18px]">
        {ticks.filter((t) => t.major).map((t) => (
          <span key={t.ms} className="absolute inset-y-0 w-px bg-border" style={{ left: pct(t.ms) }} />
        ))}
        {rest && (
          <>
            {/* The rest: its minimum solid, the rest beyond it lighter. */}
            <span className="absolute inset-y-[6px] rounded-l-[2px] bg-foreground/30" style={range(rest.startMs, Math.min(rest.legalMs, rest.endMs))} />
            {rest.endMs > rest.legalMs && <span className="absolute inset-y-[6px] bg-foreground/12" style={range(rest.legalMs, rest.endMs)} />}
            {/* A report inside the minimum: the shortfall, red. */}
            {rest.short && <span className="absolute inset-y-[4px] bg-destructive" style={range(rest.endMs, rest.legalMs)} />}
          </>
        )}
        {duty && (
          <>
            <span className="absolute inset-y-0 rounded-[3px] border border-foreground/30 bg-muted" style={range(duty.reportMs, duty.endMs)} />
            <span className="absolute inset-y-[1px] rounded-[2px] bg-foreground/10" style={range(duty.fdpStartMs, duty.fdpEndMs)} />
            {c.legs.map((l, i) =>
              l.departMs !== null && l.arriveMs !== null ? (
                <span key={i} className={cn("absolute inset-y-[3px] rounded-[2px]", l.flown ? "bg-foreground/55" : "bg-primary")} style={range(l.departMs, l.arriveMs)} />
              ) : null,
            )}
            {duty.maxEndMs !== null && (
              <>
                {/* The FDP the regulation allows: a dotted outline to its end, and a mark there. */}
                <span className="absolute -inset-y-[3px] rounded-[4px] border border-dashed border-foreground/55" style={range(duty.fdpStartMs, duty.maxEndMs)} />
                {over && <span className="absolute inset-y-[3px] bg-destructive" style={range(duty.maxEndMs, duty.fdpEndMs)} />}
                <span className="absolute -inset-y-1.5 w-0.5 -translate-x-1/2 rounded-full bg-foreground/70" style={{ left: pct(duty.maxEndMs) }} />
              </>
            )}
          </>
        )}
        {c.legs.length === 0 && rest && !duty && <span className="absolute -inset-y-1 w-0.5 -translate-x-1/2 bg-foreground/70" style={{ left: pct(rest.legalMs) }} />}
        <NowMark c={c} pct={pct} />
      </div>
      <div className="relative mt-1 h-1.5">
        {ticks.map((t) => (
          <span key={t.ms} className={cn("absolute top-0 w-px", t.major ? "h-1.5 bg-foreground/45" : "h-1 bg-foreground/20")} style={{ left: pct(t.ms) }} />
        ))}
      </div>
      <div className="relative h-3 text-[9px] tabular-nums text-muted-foreground">
        {ticks
          // Clear of both ends: the "Z" at the right, the strip's edge at the left.
          .filter((t) => t.label && t.ms < c.toMs - c.labelHours * 3_600_000 * 0.4 && t.ms > c.fromMs + c.labelHours * 3_600_000 * 0.15)
          .map((t) => (
            <span key={t.ms} data-anchor="center" className="absolute -translate-x-1/2" style={{ left: pct(t.ms) }}>
              {t.label}
            </span>
          ))}
        <span data-anchor="end" className="absolute right-0">{zulu ? "Z" : "L"}</span>
      </div>
    </div>
  )
}

/** Now, where it falls inside the strip. */
function NowMark({ c, pct }: { c: DutyClock; pct: (ms: number) => string }) {
  if (c.nowMs <= c.fromMs || c.nowMs >= c.toMs) return null
  return <span className="absolute -inset-y-0.5 w-0.5 rounded-full bg-foreground" style={{ left: pct(c.nowMs) }} />
}

/** The tile: the state and its line, the strip, the three figures. */
export function DutyClockFace({ brief }: { brief: FlightBrief }) {
  const view = dutyClockView(brief)
  if (!view) return <DutyBand status={brief.status} now={brief.now} display={brief.display} />
  const c = dutyClock(view.input)
  const t = TONE[view.stateTone]
  const zulu = brief.display?.useZuluTime !== false
  const lit = view.stateTone === "action_required" ? "text-destructive" : view.stateTone === "warning" ? "text-status-warning" : "text-foreground"
  return (
    <section aria-label="Duty and FDP">
      {/* The maximum is not said up here as well: the FDP / Max figure below carries it. */}
      <p className={cn("flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em]", t.text)} data-morph="duty-state">
        {view.state}
      </p>
      {/* The reason, in its colour (dark cockpit: ink when all is well). */}
      <p className={cn("mt-1 truncate text-[20px] font-semibold leading-[1.15] tracking-tight", lit)} suppressHydrationWarning data-morph="duty-headline">
        {view.headline}
      </p>
      {c && <DutyClockStrip clock={c} zulu={zulu} />}
      <Scale slots={view.slots} />
    </section>
  )
}

/** The tile's edge: what its figures flag. */
export function dutyTone(brief: FlightBrief): RequirementState | null {
  const v = dutyClockView(brief)
  if (v) return v.tone
  const s = brief.status.dutyState
  return s === "action_required" ? "fail" : s === "warning" ? "caution" : null
}

