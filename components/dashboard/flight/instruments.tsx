"use client"

/**
 * The flight dashboard's INSTRUMENTS — the pieces its widgets are drawn with:
 * the annunciator, the duty clock (a scale in time with three captions under
 * it), the sector chain, the requirement colours and the limit bar.
 *
 * They came from the legal page, which they made up, and they keep its rules:
 * every state carries its own icon (never colour alone); the status ramp means
 * met / close / not met and nothing else; a bar's tone is STATED by its
 * caller, never derived from how full it is; the FDP maximum is the duty's
 * own Reg 14 figure, never a default.
 */

import { formatDayAt } from "@/lib/utils/date"
import * as React from "react"
import { Check, TriangleAlert, OctagonAlert, Info } from "lucide-react"

import { formatDutyClock, formatRestSpan, type SectorLeg } from "@/lib/utils/dashboard/duty-status"
import { ANNUNCIATOR_WORD, type AnnunciatorState } from "@/lib/utils/dashboard/pilot-status"
import type { PilotStatus } from "@/lib/utils/dashboard/pilot-status"
import type { Requirement, RequirementState } from "@/lib/utils/dashboard/legality"
import { formatInstant } from "@/lib/utils/tz-format"
import type { DisplayPreferences } from "@/types/db/stores.types"
import { cn } from "@/lib/utils"

export const STATE_ICON: Record<RequirementState, React.ComponentType<{ className?: string }>> = {
  ok: Check,
  caution: TriangleAlert,
  fail: OctagonAlert,
  unknown: TriangleAlert,
}

/**
 * The ECAM ramp. Green nominal, amber attention, red action — and every state
 * ships with its own icon, because on this page more than any other it must
 * survive a colour-blind reader and a sunlit screen.
 *
 * `glow` is a soft radial wash bled into the top of the surface. It is the one
 * decorative move on the page and it is doing a real job: the panel takes on
 * the mood of its own state before a single word has been read.
 */
export const TONE: Record<
  AnnunciatorState,
  { text: string; wash: string; glow: string; icon: React.ComponentType<{ className?: string }> }
> = {
  current: {
    text: "text-chart-2",
    wash: "bg-chart-2/10",
    glow: "from-chart-2/[0.12]",
    icon: Check,
  },
  warning: {
    text: "text-chart-4",
    wash: "bg-chart-4/10",
    glow: "from-chart-4/[0.14]",
    icon: TriangleAlert,
  },
  action_required: {
    text: "text-destructive",
    wash: "bg-destructive/10",
    glow: "from-destructive/[0.16]",
    icon: OctagonAlert,
  },
  // Not on the status ramp: nothing has been assessed, so it is neither a
  // pass nor a fail. Neutral, like the `unknown` requirement cell.
  getting_started: {
    text: "text-muted-foreground",
    wash: "bg-muted",
    glow: "from-muted-foreground/[0.08]",
    icon: Info,
  },
}

export const REQ_TONE: Record<RequirementState, { icon: string; fill: string; track: string }> = {
  ok: { icon: "text-chart-2", fill: "bg-chart-2", track: "bg-chart-2/15" },
  caution: { icon: "text-status-warning", fill: "bg-chart-4", track: "bg-chart-4/15" },
  fail: { icon: "text-destructive", fill: "bg-destructive", track: "bg-destructive/15" },
  unknown: { icon: "text-muted-foreground", fill: "bg-muted-foreground", track: "bg-muted" },
}

/** One clock for every expansion on the page, so they feel like one control. */

/**
 * A clock that ticks on the MINUTE, gated on this being the tab on screen.
 *
 * The dashboard is keep-alive — mounted on first visit and never unmounted — so
 * an ungated interval re-renders this panel every second for the rest of the
 * session while the user is somewhere else entirely.
 *
 * Every readout it drives is marked `suppressHydrationWarning`. This page is a
 * client component but Next still renders it on the server, and a clock read
 * there can never match the one read a moment later in the browser. The offset
 * name is the case that actually bites: Node's ICU renders "GMT" where the
 * browser renders "GMT+0" for the same zone, so it mismatches in production even
 * when the time agrees. The attribute does NOT inherit, so it goes on each
 * text-bearing node rather than a wrapper.
 */
export function useTick(active: boolean): number {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (!active) return
    let interval = 0
    // Catch up first — the tab may have been away for hours — then align to
    // the next minute boundary and hold to it. Nothing on this page is shown
    // to the second, so a 1Hz tick re-rendered the whole panel sixty times for
    // every change a reader could actually see.
    //
    // Both are timeout CALLBACKS rather than a synchronous write, which is
    // what keeps this out of the compiler's set-state-in-effect rule.
    const catchUp = window.setTimeout(() => setNow(Date.now()), 0)
    const align = window.setTimeout(() => {
      setNow(Date.now())
      interval = window.setInterval(() => setNow(Date.now()), 60_000)
    }, 60_000 - (Date.now() % 60_000))
    return () => {
      window.clearTimeout(catchUp)
      window.clearTimeout(align)
      if (interval) window.clearInterval(interval)
    }
  }, [active])
  return now
}

/* ── Master annunciator ──────────────────────────────────────────────────── */

/**
 * State, imperative, governing constraint. Three lines, and the hero is the
 * IMPERATIVE — never a bare figure.
 *
 * It used to print a raw rest countdown here whenever rest was outstanding,
 * which is the thing the owner called out: "legal from gives earliest window
 * for accepting a duty however without context". `nextAction.headline` already
 * carries the contextual form of the same fact — "Rest short by 3:00" when a
 * rostered duty reports inside the rest period, "Rest until 04:36" when there
 * is nothing to work backwards from — and the duty band below draws it. A
 * countdown on top of both was the same number three times.
 */
export function Annunciator({ status }: { status: PilotStatus }) {
  const tone = TONE[status.state]
  const StateIcon = tone.icon

  return (
    <div>
      <div className="flex items-center gap-2">
        <StateIcon className={cn("h-3.5 w-3.5 shrink-0", tone.text)} aria-hidden="true" />
        <span
          className={cn(
            "text-[11px] font-bold uppercase leading-none tracking-[0.16em]",
            tone.text,
          )}
        >
          {ANNUNCIATOR_WORD[status.state]}
        </span>
      </div>

      {/* The imperative — what to DO. The most valuable line on the screen, and
          the one a data-oriented dashboard never prints. */}
      <p
        className="mt-1 text-[22px] font-semibold leading-[1.1] tracking-tight text-foreground"
        suppressHydrationWarning
      >
        {status.nextAction.headline}
      </p>

      {/* The tightest constraint — never "12 / 12 current". When nothing is
          flagged this is the nearest EXPIRY, not the fullest rolling limit: a
          limit refills, so 41% of a 12-month allowance is not "tight". */}
      {/* With nothing logged there is no constraint to name — a rolling limit
          at 0 / 90h is not "tight" — so the line explains the first step. */}
      {status.state === "getting_started" ? (
        <p className="mt-1 text-xs leading-tight text-muted-foreground">
          {status.nextAction.detail}
        </p>
      ) : status.also.length > 0 ? (
        // The headline IS the governing requirement's remedy, so naming it
        // again here would be the same fact a third time (its cell is the
        // second). The line goes to the NEXT problem instead, which otherwise
        // showed only as a cell to be found.
        <p className="mt-1 truncate text-xs leading-tight text-muted-foreground">
          Also{" "}
          <span className="font-medium text-foreground/80 tabular-nums">
            {status.also[0].action ?? `${status.also[0].label} ${status.also[0].value}`}
          </span>
          {status.also.length > 1 && (
            <>
              <span className="mx-1 text-muted-foreground/40">·</span>
              <span className="tabular-nums">+{status.also.length - 1} More</span>
            </>
          )}
        </p>
      ) : status.governing && status.nextAction.headline === status.governing.action ? (
        // One problem, and the headline has said it: the line names WHICH
        // requirement, without repeating its figure.
        <p className="mt-1 text-xs leading-tight text-muted-foreground">{status.governing.label}</p>
      ) : status.governing && (
        <p className="mt-1 text-xs leading-tight text-muted-foreground">
          <span className="text-muted-foreground">Tightest</span>{" "}
          {status.governing.label}
          <span className="mx-1 text-muted-foreground/40">·</span>
          <span className="font-medium text-foreground/80 tabular-nums">
            {status.governing.value}
          </span>
        </p>
      )}
    </div>
  )
}

/* ── Duty ────────────────────────────────────────────────────────────────── */

/**
 * The ramp the duty band draws with.
 *
 * `ok`/`caution`/`fail` are the status ramp and mean what they mean everywhere
 * else on this page — met, close, not met. `info` is deliberately NOT on that
 * ramp: a standby window filling up is a magnitude, not a verdict, and painting
 * it amber would teach the reader that the colour means the same thing there as
 * it does on a requirement cell. `idle` is "there is no limit to draw".
 */
export const RAMP = {
  ok: { fill: "bg-chart-2", text: "text-chart-2" },
  caution: { fill: "bg-chart-4", text: "text-chart-4" },
  fail: { fill: "bg-destructive", text: "text-destructive" },
  info: { fill: "bg-primary", text: "text-primary" },
  idle: { fill: "bg-muted-foreground/40", text: "text-muted-foreground" },
} as const

export type Ramp = keyof typeof RAMP

/** One slot of the scale beneath the timeline. */
interface Slot {
  value: string
  label: string
  /** A clock read off the live tick, so it cannot match the server render. */
  live?: boolean
  tone?: Ramp
}

/**
 * The duty band, and the one place the regulatory nuance shows.
 *
 * It answers ONE question, in whichever form the phase demands, and it answers
 * it as a PICTURE with three captions beneath rather than as a column of
 * label/value pairs:
 *
 * | Phase | The question | The bar runs |
 * |---|---|---|
 * | on duty | how much FDP is left | FDP window open → its Reg 14 maximum |
 * | off duty, duty ahead | will the rest reach the report | rest commenced → the later of legal / report |
 * | off duty, nothing ahead | when may I go again | rest commenced → legal |
 * | standby | how long am I committed for | window start → window end |
 *
 * The second row is the one that needed a picture. "Legal from 04:36" says
 * nothing on its own — what a rest period has to be depends on the duty AHEAD
 * as much as the one behind (para 4 wants 24 hours inclusive of a local night
 * before a duty touching the window of circadian low) — so the report time is a
 * CARET on the same scale as the rest, and a report that lands inside the rest
 * still owed is a red band you can see before you have read a word.
 *
 * The maximum is whatever CAAS Reg 14 produced for THIS duty — report time,
 * sectors, crew complement and acclimatisation already applied — and the table
 * that produced it is printed beside it. With no computed maximum the band says
 * so rather than inventing one; a default is a number somebody might fly to.
 */
export function DutyBand({
  status,
  now,
  display,
}: {
  status: PilotStatus
  now: number
  display?: DisplayPreferences
}) {
  const { phase, active, lastDuty, next, rest, standby } = status.duty

  const zone = React.useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])
  const clockAt = (ms: number) => formatInstant(ms, display, zone)
  // "6 NOV" — the app's day (`formatDay`), less the weekday and year a
  // caption has no room for.
  const dayAt = (ms: number) =>
    formatDayAt(ms, display?.useZuluTime === false ? zone : "UTC", { weekday: false, year: false }).toUpperCase()
  // ONE clock per cell. The figure above it is when rest COMMENCED, so the
  // caption says that and which day — it read "08:05Z" over "ENDED 07:05Z",
  // two clocks an hour apart with nothing saying which was which, and no day
  // on a rest that may have begun a week ago. "Min", not "Of": the middle
  // cell is a span ("8d 8h") beside a requirement, not a fraction of it.
  const restFromLabel = (ms: number) => `Rest From ${dayAt(ms)}`

  const onDuty = phase === "on_duty" && active !== null
  // A standby IS a duty. It is not a FLIGHT duty period — paragraph 14's
  // tables never applied to it, so there is no FDP to gauge — but reading it
  // as "off duty" is worse than reading it as a flight duty: the pilot is
  // committed, contactable and could be called at any moment.
  const onStandby = !onDuty && standby !== null

  /**
   * Everything the band renders, decided once. Assembling it here rather than
   * branching through the JSX is what keeps the four phases visibly parallel —
   * they are the same instrument reading a different scale, not four layouts.
   */
  const view = ((): {
    state: string
    chip?: string
    chipTone?: Ramp
    bar: { fromMs: number; toMs: number; tone: Ramp; caretMs?: number; deficitFromMs?: number } | null
    scale: Slot[]
    footnote?: { text: string; tone?: Ramp }
    legs: SectorLeg[]
    nextRoute?: string
  } => {
    /* ── On duty ─────────────────────────────────────────────────────────── */
    if (onDuty) {
      const hasFdp = active.maxFdpMinutes > 0
      // Para 10(b) can open the FDP window BEFORE the crew member reports, so
      // the bar starts where the FDP started, not where the duty did.
      const fdpOpenMs =
        active.startMs - (active.fdpElapsedMinutes - active.elapsedMinutes) * 60_000
      const left = Math.max(0, active.maxFdpMinutes - active.fdpElapsedMinutes)
      const fraction = hasFdp ? active.fdpElapsedMinutes / active.maxFdpMinutes : 0

      return {
        state: "On duty",
        chip: hasFdp
          ? [
              active.fdpTable && `Table ${active.fdpTable}`,
              `Max ${formatDutyClock(active.maxFdpMinutes)}`,
              active.augmented && "Aug",
            ]
              .filter(Boolean)
              .join(" · ")
          : active.notFdp
            ? `${active.notFdp} · Not an FDP`
            : "No FDP limit computed",
        chipTone: hasFdp ? undefined : "idle",
        bar: hasFdp
          ? {
              fromMs: fdpOpenMs,
              toMs: fdpOpenMs + active.maxFdpMinutes * 60_000,
              tone: active.exceeded ? "fail" : fraction >= 0.8 ? "caution" : "ok",
            }
          : null,
        scale: [
          { value: clockAt(active.startMs), label: "Reported" },
          { value: formatDutyClock(active.flightMinutes), label: "Flight" },
          {
            value: hasFdp ? formatDutyClock(left) : "—",
            label: active.exceeded ? "FDP exceeded" : "FDP left",
            live: true,
            tone: active.exceeded ? "fail" : undefined,
          },
        ],
        legs: active.legs,
      }
    }

    /* ── Standby ─────────────────────────────────────────────────────────── */
    if (onStandby) {
      const left = Math.max(0, standby.remainingMinutes)
      return {
        state: standby.code,
        chip: standby.activated ? "Activated" : "Not called",
        chipTone: standby.activated ? "info" : undefined,
        // The standby's OWN window. It is a magnitude, not a verdict, so it is
        // never on the status ramp — see `RAMP`.
        bar: { fromMs: standby.startMs, toMs: standby.endMs, tone: "info" },
        scale: [
          { value: clockAt(standby.startMs), label: "From" },
          { value: formatDutyClock(left), label: "Left", live: true },
          { value: clockAt(standby.endMs), label: "Until" },
        ],
        // An un-called standby is rest, so the rest clock keeps running
        // beneath it — "if they ring now, am I legal" has to be answerable.
        footnote: rest
          ? rest.isLegalNow
            ? { text: "Rested — legal now", tone: "ok" }
            : {
                text: `Rest to ${clockAt(Date.parse(rest.legalAtUtc))}`,
                tone: "caution",
              }
          : undefined,
        legs: [],
        nextRoute: next?.route,
      }
    }

    /* ── Off duty, with a duty ahead ─────────────────────────────────────── */
    // The load-bearing case: rest worked BACKWARDS from the next duty, so the
    // comparison is what this rest IS against what THAT duty needs.
    if (next && next.restRequiredMinutes > 0) {
      const restStartMs = next.reportMs - next.restAvailableMinutes * 60_000
      const legalAtMs = restStartMs + next.restRequiredMinutes * 60_000
      const short = next.legalAtReport === false

      return {
        state: phase === "post_duty" ? "Duty complete" : "Off duty",
        chip: lastDuty?.route ? `Last ${lastDuty.route}` : undefined,
        bar: {
          fromMs: restStartMs,
          toMs: Math.max(next.reportMs, legalAtMs),
          tone: short ? "fail" : rest?.isLegalNow ? "ok" : "caution",
          caretMs: next.reportMs,
          // The rest still owed at the moment of report — the shortfall, drawn
          // where it happens rather than stated as a number somewhere else.
          deficitFromMs: short ? next.reportMs : undefined,
        },
        scale: [
          {
            value: clockAt(restStartMs),
            label: restFromLabel(restStartMs),
          },
          {
            value: formatRestSpan(next.restAvailableMinutes),
            label: short
              ? `Short ${formatDutyClock(next.restShortfallMinutes)}`
              : `Min ${formatDutyClock(next.restRequiredMinutes)}`,
            tone: short ? "fail" : undefined,
          },
          {
            value: clockAt(next.reportMs),
            label: `Report ${dayAt(next.reportMs)}`,
          },
        ],
        // What that duty ASKS of you — its FLIGHT duty period, report to last
        // on-blocks, against its own Reg 14 maximum. A report time says when to
        // turn up; this says what turning up commits you to.
        footnote:
          next.plannedFdpMinutes > 0
            ? {
                text:
                  next.maxFdpMinutes > 0
                    ? `Next duty · FDP ${formatDutyClock(next.plannedFdpMinutes)} of ${formatDutyClock(next.maxFdpMinutes)}`
                    : `Next duty · FDP ${formatDutyClock(next.plannedFdpMinutes)}, no limit computed`,
                tone:
                  next.maxFdpMinutes > 0 && next.plannedFdpMinutes > next.maxFdpMinutes
                    ? "fail"
                    : undefined,
              }
            : { text: "Next duty" },
        legs: [],
        nextRoute: next.route,
      }
    }

    /* ── Off duty, nothing ahead ─────────────────────────────────────────── */
    // Nothing to work backwards from, so the only thing that can be said is the
    // earliest a duty could be planned — the requirement from the duty just
    // flown alone.
    if (rest) {
      const restStartMs = now - rest.elapsedMinutes * 60_000
      const legalAtMs = Date.parse(rest.legalAtUtc)
      return {
        state: phase === "post_duty" ? "Duty complete" : "Off duty",
        chip: lastDuty?.route ? `Last ${lastDuty.route}` : undefined,
        bar: {
          fromMs: restStartMs,
          toMs: Number.isFinite(legalAtMs) && legalAtMs > restStartMs ? legalAtMs : now,
          tone: rest.isLegalNow ? "ok" : "caution",
        },
        scale: [
          {
            value: clockAt(restStartMs),
            label: restFromLabel(restStartMs),
          },
          {
            value: formatRestSpan(rest.elapsedMinutes),
            label: `Min ${formatDutyClock(rest.requiredMinutes)}`,
            live: true,
          },
          {
            value: rest.isLegalNow ? "Now" : clockAt(legalAtMs),
            label: "Legal From",
            tone: rest.isLegalNow ? "ok" : undefined,
          },
        ],
        footnote: { text: "No duty rostered", tone: "idle" },
        legs: [],
      }
    }

    /* ── Nothing known ───────────────────────────────────────────────────── */
    return {
      state: "Off duty",
      chip: lastDuty?.route ? `Last ${lastDuty.route}` : undefined,
      bar: null,
      scale: lastDuty
        ? [{ value: clockAt(lastDuty.debriefMs), label: "Last Duty Ended" }]
        : [],
      footnote: { text: "No duty rostered", tone: "idle" },
      legs: [],
      nextRoute: next?.route,
    }
  })()

  return (
    <section aria-label="Duty">
      <div className="flex items-baseline justify-between gap-2">
        <p className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {view.state}
        </p>
        {view.chip && (
          <p
            // A long multi-sector route can still truncate on a 360px phone;
            // the full text stays reachable.
            title={view.chip}
            className={cn(
              "min-w-0 truncate text-[10px] font-medium tabular-nums",
              view.chipTone ? RAMP[view.chipTone].text : "text-muted-foreground",
            )}
          >
            {view.chip}
          </p>
        )}
      </div>

      {view.bar && <Timeline {...view.bar} nowMs={now} />}

      {view.scale.length > 0 && <Scale slots={view.scale} />}

      {view.footnote && (
        <p
          className={cn(
            "mt-1.5 text-[11px] leading-tight",
            view.footnote.tone ? RAMP[view.footnote.tone].text : "text-muted-foreground",
          )}
          suppressHydrationWarning
        >
          {view.footnote.text}
        </p>
      )}

    </section>
  )
}

/**
 * The band's one picture: a scale in TIME, with now as the fill's leading edge.
 *
 * A ring was here before and it could only ever draw one quantity. The whole
 * off-duty question is a COMPARISON between two instants on the same axis —
 * when the rest becomes legal and when the next duty reports — and an arc has
 * nowhere to put the second one. On a line they are simply two marks, and a
 * report that lands inside the rest still owed is a red band.
 *
 * The tone is STATED by the caller, never derived from how full the bar is: a
 * nearly-full FDP bar is a warning and a nearly-full REST bar is good news.
 */
export function Timeline({
  fromMs,
  toMs,
  nowMs,
  tone,
  caretMs,
  deficitFromMs,
}: {
  fromMs: number
  toMs: number
  nowMs: number
  tone: Ramp
  /** A second instant on the same axis — the next duty's report time. */
  caretMs?: number
  /** Painted from here to the end: time that is owed and is not available. */
  deficitFromMs?: number
}) {
  const span = Math.max(1, toMs - fromMs)
  const pct = (ms: number) => Math.min(100, Math.max(0, ((ms - fromMs) / span) * 100))

  return (
    <div className="relative mt-2 h-2.5">
      <div className="absolute inset-0 overflow-hidden rounded-full bg-muted">
        {deficitFromMs !== undefined && (
          <span
            className="absolute inset-y-0 right-0 bg-destructive/25"
            style={{ left: `${pct(deficitFromMs)}%` }}
            aria-hidden="true"
          />
        )}
        <span
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 motion-reduce:transition-none",
            RAMP[tone].fill,
          )}
          style={{ width: `${pct(nowMs)}%` }}
          aria-hidden="true"
        />
      </div>
      {caretMs !== undefined && (
        <span
          className="absolute -top-1 h-[18px] w-[2px] -translate-x-1/2 rounded-full bg-foreground"
          style={{ left: `${pct(caretMs)}%` }}
          aria-hidden="true"
        />
      )}
    </div>
  )
}

/**
 * Three figures under the bar, in reading order: where this started, what it
 * comes to, and where it ends.
 *
 * They are the band's whole text. The stack of right-aligned label/value rows
 * they replaced said the same things in a column, which is the shape of a
 * spreadsheet rather than of an instrument — and it left no room for the bar to
 * be wide enough to read.
 */
export function Scale({ slots }: { slots: Slot[] }) {
  return (
    <div className="mt-1.5 flex items-start gap-2">
      {slots.map((slot, i) => (
        <div
          key={slot.label}
          className={cn(
            "min-w-0 flex-1",
            slots.length > 1 && i === 1 && "text-center",
            slots.length > 1 && i === slots.length - 1 && "text-right",
          )}
        >
          <span
            className={cn(
              "block truncate text-sm font-semibold leading-tight tabular-nums",
              slot.tone ? RAMP[slot.tone].text : "text-foreground",
            )}
            suppressHydrationWarning={slot.live}
          >
            {slot.value}
          </span>
          <span className="block truncate text-[9px] font-medium uppercase leading-tight tracking-wider text-muted-foreground">
            {slot.label}
          </span>
        </div>
      ))}
    </div>
  )
}


/**
 * The duty's legs as a chain of stops.
 *
 * Filled dot = on blocks, ringed dot = the leg being flown, hollow = still to
 * come. The airport codes sit under the dots, so a four-sector day reads as a
 * pattern rather than as a route string nobody can locate themselves in.
 */
export function SectorChain({
  legs,
  nextRoute,
  legGates,
  times,
  onOpen,
}: {
  legs: SectorLeg[]
  nextRoute?: string
  /** Each leg's gates in order; drawn under the stops when they line up with the chain. */
  legGates?: { dep: string; arr: string }[]
  /** A clock under each stop — the departure from the first, the arrival at the rest. */
  times?: string[]
  onOpen?: () => void
}) {
  const stops = React.useMemo(() => {
    if (legs.length > 0) {
      return [
        { code: legs[0].from, done: legs[0].status === "complete" },
        ...legs.map((l) => ({ code: l.to, done: l.status === "complete" })),
      ]
    }
    // No duty in hand — show the next one's shape so the band is never empty.
    const chain = (nextRoute || "").split("-").filter(Boolean)
    return chain.map((code) => ({ code, done: false }))
  }, [legs, nextRoute])

  if (stops.length < 2) return null

  const activeIndex = legs.findIndex((l) => l.status === "active")
  // A stop's gate is the departure gate of the leg leaving it, and the last
  // stop's is the last leg's arrival gate. Only when the logbook's legs ARE
  // the chain's — otherwise a gate could sit under the wrong airport.
  const gates =
    legGates && legGates.length === stops.length - 1 && legGates.some((g) => g.dep || g.arr)
      ? stops.map((_, i) => (i < legGates.length ? legGates[i].dep : legGates[i - 1].arr))
      : null

  // A button when it opens its duty — the same box either way, so the band's
  // height does not move; the hit area grows by a pseudo-element instead.
  const Box = onOpen ? "button" : "div"
  return (
    <Box
      {...(onOpen
        ? { type: "button" as const, onClick: onOpen, "aria-label": "Gates and aircraft for this duty" }
        : {})}
      className={cn(
        "flex w-full items-start",
        onOpen &&
          "relative rounded-md text-left after:absolute after:-inset-y-2 after:inset-x-0 after:content-[''] focus-visible:outline-2 focus-visible:outline-ring",
      )}
    >
      {stops.map((stop, i) => (
        <React.Fragment key={`${stop.code}-${i}`}>
          {i > 0 && (
            <span
              className={cn(
                "mt-[5px] h-[2px] min-w-4 flex-1 rounded-full",
                stops[i].done ? "bg-chart-2" : i - 1 === activeIndex ? "bg-chart-2/40" : "bg-border",
              )}
              aria-hidden="true"
            />
          )}
          <span className="flex shrink-0 flex-col items-center gap-1">
            <span
              className={cn(
                "h-3 w-3 rounded-full border-2",
                stop.done
                  ? "border-chart-2 bg-chart-2"
                  : i === activeIndex + 1 && activeIndex >= 0
                    ? "border-chart-2 bg-card"
                    : "border-border bg-card",
              )}
            />
            <span
              className={cn(
                "text-[10px] font-medium tabular-nums",
                stop.done ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {stop.code}
            </span>
            {times && times.length === stops.length && (
              <span className="text-[10px] leading-none tabular-nums text-muted-foreground" suppressHydrationWarning>
                {times[i] || "–"}
              </span>
            )}
            {gates && (
              <span className="text-[10px] font-semibold leading-none tabular-nums text-foreground" suppressHydrationWarning>
                {gates[i] || "–"}
              </span>
            )}
          </span>
        </React.Fragment>
      ))}
    </Box>
  )
}

/* ── Limits ──────────────────────────────────────────────────────────────── */

/**
 * How much of the limit is gone, read straight off the bar.
 *
 * The bar is thick enough to hold its own number (h-5), so the hours used sit
 * at the end of the FILL and the limit sits after the track — `[▓▓▓ 74 ░░░] 90h`
 * — instead of the whole figure being a separate "74 / 90h" the eye has to
 * pair up with a hairline.
 *
 * The label is placed INSIDE the fill only when the fill is wide enough to hold
 * it with padding; below that it goes just outside the fill's end, so it can
 * never be clipped by its own mark.
 */
const LABEL_FITS_INSIDE = 0.28

/**
 * A limit with room in it is a MAGNITUDE, not a verdict — so its bar is
 * neutral, the way a met currency cell carries no tint. All four bars were
 * status green, 3% used and 60% used alike: a band of green that said "fine"
 * four times and left an amber one less to stand out against. Colour arrives
 * with the state (close → amber, over → red), and so does the icon.
 */
const LIMIT_WITH_ROOM = { fill: "bg-muted-foreground", track: "bg-muted" }

export function LimitRow({ requirement }: { requirement: Requirement }) {
  const tone = requirement.state === "ok" ? { ...REQ_TONE.ok, ...LIMIT_WITH_ROOM } : REQ_TONE[requirement.state]
  const Icon = STATE_ICON[requirement.state]
  // "Duty 14d" → "14d": the pair's label already says which measure it is.
  const window = requirement.label.split(" ").slice(-1)[0]
  // "74 / 90h" → used "74", limit "90h".
  const [used, limit] = requirement.value.split(" / ")
  const fraction = Math.min(1, Math.max(0, requirement.progress ?? 0))
  const inside = fraction >= LABEL_FITS_INSIDE

  return (
    <div className="flex items-center gap-2">
      <span className="w-7 shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground">
        {window}
      </span>

      <span className={cn("relative h-5 min-w-0 flex-1 overflow-hidden rounded-md", tone.track)}>
        <span
          className={cn(
            "absolute inset-y-0 left-0 flex items-center justify-end rounded-md px-1.5",
            tone.fill,
          )}
          style={{ width: `${fraction * 100}%` }}
        >
          {inside && (
            <span className="text-[10px] font-bold tabular-nums text-background">{used}</span>
          )}
        </span>
        {!inside && (
          <span
            className="absolute inset-y-0 flex items-center pl-1.5 text-[10px] font-bold tabular-nums text-foreground"
            style={{ left: `${fraction * 100}%` }}
          >
            {used}
          </span>
        )}
      </span>

      {requirement.state !== "ok" && (
        <Icon className={cn("h-3 w-3 shrink-0", tone.icon)} aria-hidden="true" />
      )}
      <span className="w-10 shrink-0 text-right text-[11px] font-semibold tabular-nums text-muted-foreground">
        {limit}
      </span>
    </div>
  )
}

