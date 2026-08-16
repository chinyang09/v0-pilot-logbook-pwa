"use client"

import * as React from "react"
import Link from "next/link"
import { motion, AnimatePresence } from "framer-motion"
import { Check, TriangleAlert, OctagonAlert, ChevronRight, ArrowUpRight } from "lucide-react"

import { usePilotStatus } from "@/hooks/data/use-pilot-status"
import { usePageActive } from "@/hooks/use-page-active"
import { useDashboardAggregates } from "@/hooks/data/use-dashboard-aggregates"
import { formatDutyClock, type SectorLeg } from "@/lib/utils/dashboard/duty-status"
import { ANNUNCIATOR_WORD, type AnnunciatorState } from "@/lib/utils/dashboard/pilot-status"
import type { PilotStatus } from "@/lib/utils/dashboard/pilot-status"
import type { Requirement, RequirementState } from "@/lib/utils/dashboard/legality"
import { formatInstant, tzFormatter } from "@/lib/utils/tz-format"
import { usePreferences } from "@/components/providers/preferences-provider"
import type { DisplayPreferences } from "@/types/db/stores.types"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/**
 * The legal dashboard — one screen, no scroll, read like an instrument.
 *
 * Four bands, in the order a pilot asks: what is my state and what must I do
 * (the annunciator), where am I in this duty (the gauge and the sector chain),
 * am I qualified (currency), and how much have I used (limits).
 *
 * **ONE CONTINUOUS SURFACE, not a stack of cards.** Six glass cards with their
 * own borders, radii and 12px margins spend roughly 120px of a phone's height
 * on separation alone, which is the difference between this fitting and not.
 *
 * **Nothing here navigates by default.** A cell EXPANDS in place — the reader
 * is checking a status, and sending them to another page loses the screen they
 * came to read and costs a back-navigation to recover it. A deep link is
 * offered inside the expansion, for the cases a couple of lines cannot answer.
 *
 * **Currency and limits are separate bands, and that is not cosmetic.** A
 * currency is measured in DAYS and expires; a limit is measured in HOURS and
 * refills. Sorting them into one grid by urgency put a document expiry between
 * two duty-hour rows and split the takeoff and landing halves of one question
 * across the grid — which is exactly the "jumbled" complaint. Now each band
 * holds one kind of thing, and within the duty band the rolling limits are
 * gone entirely: they were printed twice.
 */

const STATE_ICON: Record<RequirementState, React.ComponentType<{ className?: string }>> = {
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
const TONE: Record<
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
}

const REQ_TONE: Record<RequirementState, { icon: string; fill: string; track: string }> = {
  ok: { icon: "text-chart-2", fill: "bg-chart-2", track: "bg-chart-2/15" },
  caution: { icon: "text-chart-4", fill: "bg-chart-4", track: "bg-chart-4/15" },
  fail: { icon: "text-destructive", fill: "bg-destructive", track: "bg-destructive/15" },
  unknown: { icon: "text-muted-foreground", fill: "bg-muted-foreground", track: "bg-muted" },
}

/** One clock for every expansion on the page, so they feel like one control. */
const EXPAND = { duration: 0.24, ease: [0.4, 0, 0.2, 1] as const }

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
function useTick(active: boolean): number {
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

export function LegalDashboard({ className }: { className?: string }) {
  const isActive = usePageActive("/")
  const now = useTick(isActive)
  const { preferences } = usePreferences()

  // Recency comes off the dashboard aggregate rather than a second walk of the
  // flight history. The range is irrelevant to it — recency is always computed
  // over the full history.
  const { aggregates, isLoading: aggLoading } = useDashboardAggregates({
    fromIso: "1970-01-01",
    toIso: "9999-12-31",
  })
  const { status, isLoading: statusLoading } = usePilotStatus(
    aggregates.ninetyDayCurrency,
    now,
    preferences?.display,
  )

  if (aggLoading || statusLoading) {
    return <Skeleton className={cn("h-full min-h-[24rem] rounded-3xl", className)} />
  }

  return (
    <LegalDashboardView
      status={status}
      now={now}
      display={preferences?.display}
      className={className}
    />
  )
}

/** The presentational half — pure props, so it renders without the database. */
export function LegalDashboardView({
  status,
  now,
  display,
  className,
}: {
  status: PilotStatus
  now: number
  /**
   * The app's display settings. Every point in time on this page goes through
   * them — Zulu or local, 12 or 24 hour, colon or bare — so the page cannot
   * disagree with the rest of the app about what time it is.
   */
  display?: DisplayPreferences
  className?: string
}) {
  const tone = TONE[status.state]

  const currency = status.legality.requirements.filter((r) => r.group === "currency")
  const limits = status.legality.requirements.filter((r) => r.group === "limits")

  return (
    <div
      className={cn(
        // `max-h-full`, NOT `h-full`: stretching the surface to the viewport
        // makes one section absorb every spare pixel, which on a tall phone
        // left ~200px of empty grid below the last row.
        "@container relative flex max-h-full flex-col overflow-hidden rounded-3xl border border-border/60 bg-card/70 shadow-sm",
        className,
      )}
    >
      {/* The state's mood, bled into the top of the surface. Pointer-events
          none and behind everything — it is atmosphere, not a control. */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b to-transparent",
          tone.glow,
        )}
        aria-hidden="true"
      />

      <div className="relative flex min-h-0 flex-col divide-y divide-border/40">
        <Annunciator status={status} />
        <DutyBand status={status} now={now} display={display} />
        <CurrencyBand requirements={currency} />
        <LimitsBand requirements={limits} />
      </div>
    </div>
  )
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
function Annunciator({ status }: { status: PilotStatus }) {
  const tone = TONE[status.state]
  const StateIcon = tone.icon

  return (
    <div className="px-4 pb-3 pt-1">
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
        className="mt-1.5 text-[26px] font-semibold leading-[1.1] tracking-tight text-foreground"
        suppressHydrationWarning
      >
        {status.nextAction.headline}
      </p>

      {/* The tightest constraint — never "12 / 12 current". When nothing is
          flagged this is the nearest EXPIRY, not the fullest rolling limit: a
          limit refills, so 41% of a 12-month allowance is not "tight". */}
      {status.governing && (
        <p className="mt-1 text-xs leading-tight text-muted-foreground">
          <span className="text-muted-foreground/70">Tightest</span>{" "}
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
const RAMP = {
  ok: { fill: "bg-chart-2", text: "text-chart-2" },
  caution: { fill: "bg-chart-4", text: "text-chart-4" },
  fail: { fill: "bg-destructive", text: "text-destructive" },
  info: { fill: "bg-primary", text: "text-primary" },
  idle: { fill: "bg-muted-foreground/40", text: "text-muted-foreground" },
} as const

type Ramp = keyof typeof RAMP

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
function DutyBand({
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
  const dayAt = (ms: number) =>
    tzFormatter(display?.useZuluTime === false ? zone : "UTC", {
      day: "2-digit",
      month: "short",
    }, "daymon")
      .format(new Date(ms))
      .toUpperCase()

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
            label: lastDuty ? `Ended ${clockAt(lastDuty.debriefMs)}` : "Rest from",
          },
          {
            value: formatDutyClock(next.restAvailableMinutes),
            label: short
              ? `Short ${formatDutyClock(next.restShortfallMinutes)}`
              : `Of ${formatDutyClock(next.restRequiredMinutes)}`,
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
            label: lastDuty ? `Ended ${clockAt(lastDuty.debriefMs)}` : "Rest from",
          },
          {
            value: formatDutyClock(rest.elapsedMinutes),
            label: `Of ${formatDutyClock(rest.requiredMinutes)}`,
            live: true,
          },
          {
            value: rest.isLegalNow ? "Now" : clockAt(legalAtMs),
            label: "Legal from",
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
        ? [{ value: clockAt(lastDuty.debriefMs), label: "Last duty ended" }]
        : [],
      footnote: { text: "No duty rostered", tone: "idle" },
      legs: [],
      nextRoute: next?.route,
    }
  })()

  return (
    <section className="px-4 py-2.5" aria-label="Duty">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
          {view.state}
        </p>
        {view.chip && (
          <p
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

      {/* The sector chain. A duty is up to four legs across several airports,
          and "where am I in the pattern" is what the old recent-flights list
          could never answer — it showed history, not this duty. On duty it is
          THIS duty's progress; otherwise it is the NEXT duty's shape, which is
          what the footnote above it has just named. */}
      <SectorChain legs={view.legs} nextRoute={view.nextRoute} />
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
function Timeline({
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
function Scale({ slots }: { slots: Slot[] }) {
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
function SectorChain({ legs, nextRoute }: { legs: SectorLeg[]; nextRoute?: string }) {
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

  return (
    <div className="mt-3 flex items-start">
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
          </span>
        </React.Fragment>
      ))}
    </div>
  )
}

/* ── Currency ────────────────────────────────────────────────────────────── */

/**
 * Everything measured in DAYS — recency and documents, nearest expiry first.
 *
 * Recency is ONE row, not two: takeoffs and landings are two halves of one
 * question, and as separate urgency-sorted cells they did not even end up next
 * to each other. Expanding the row shows both counts.
 */
function CurrencyBand({ requirements }: { requirements: Requirement[] }) {
  const ordered = React.useMemo(
    () => [...requirements].sort((a, b) => (a.daysUntil ?? 9e9) - (b.daysUntil ?? 9e9)),
    [requirements],
  )
  return (
    <Band label="Currency" requirements={ordered} flexible>
      {ordered.map((r) => (
        <ExpandableRow key={r.id} requirement={r} />
      ))}
    </Band>
  )
}

/* ── Limits ──────────────────────────────────────────────────────────────── */

/**
 * Everything measured in HOURS, paired by what it limits.
 *
 * Duty over its two windows, then flight over its two — which is how the
 * regulation is written and how a pilot holds it. Four independent rows sorted
 * by urgency scattered the pairs and was most of why this read as jumbled.
 */
function LimitsBand({ requirements }: { requirements: Requirement[] }) {
  const byId = React.useMemo(
    () => new Map(requirements.map((r) => [r.id, r])),
    [requirements],
  )
  const pairs: Array<{ label: string; rows: Requirement[] }> = [
    {
      label: "Duty",
      rows: [byId.get("duty-14"), byId.get("duty-28")].filter(Boolean) as Requirement[],
    },
    {
      label: "Flight",
      rows: [byId.get("flight-28"), byId.get("flight-365")].filter(Boolean) as Requirement[],
    },
  ]

  return (
    <Band label="Limits" requirements={requirements}>
      <div className="space-y-1.5">
        {pairs.map((pair) => (
          <div key={pair.label} className="flex items-start gap-3">
            <span className="w-10 shrink-0 pt-[3px] text-[11px] font-medium text-muted-foreground">
              {pair.label}
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              {pair.rows.map((r) => (
                <LimitRow key={r.id} requirement={r} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Band>
  )
}

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

function LimitRow({ requirement }: { requirement: Requirement }) {
  const tone = REQ_TONE[requirement.state]
  const Icon = STATE_ICON[requirement.state]
  // "Duty 14d" → "14d": the pair's label already says which measure it is.
  const window = requirement.label.split(" ").slice(-1)[0]
  // "74 / 90h" → used "74", limit "90h".
  const [used, limit] = requirement.value.split(" / ")
  const fraction = Math.min(1, Math.max(0, requirement.progress ?? 0))
  const inside = fraction >= LABEL_FITS_INSIDE

  return (
    <div className="flex items-center gap-2">
      <span className="w-7 shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground/70">
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

/* ── Shared band chrome ──────────────────────────────────────────────────── */

function Band({
  label,
  requirements,
  children,
  flexible,
}: {
  label: string
  requirements: Requirement[]
  children: React.ReactNode
  /** The band that absorbs a squeeze and scrolls inside itself. Exactly one. */
  flexible?: boolean
}) {
  const fail = requirements.filter((r) => r.state === "fail").length
  const caution = requirements.filter((r) => r.state === "caution").length

  return (
    <section
      className={cn(
        "px-4 py-2.5",
        flexible && "min-h-0 flex-1 overflow-y-auto scrollbar-hide",
      )}
      aria-label={label}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
          {label}
        </p>
        <span className="flex items-center gap-2 text-[10px] tabular-nums">
          {fail > 0 && (
            <span className="inline-flex items-center gap-0.5 font-semibold text-destructive">
              <OctagonAlert className="h-2.5 w-2.5" aria-hidden="true" />
              {fail}
            </span>
          )}
          {caution > 0 && (
            <span className="inline-flex items-center gap-0.5 font-semibold text-chart-4">
              <TriangleAlert className="h-2.5 w-2.5" aria-hidden="true" />
              {caution}
            </span>
          )}
          {fail === 0 && caution === 0 && (
            <Check className="h-3 w-3 text-chart-2" aria-hidden="true" />
          )}
        </span>
      </div>
      {children}
    </section>
  )
}

/**
 * A currency row that opens in place.
 *
 * Tap to reveal the detail, tap again to close. Nothing navigates: the reader
 * came to this screen to check a status, and a route change loses it. The deep
 * link lives INSIDE the expansion, where it is a deliberate second step rather
 * than the accidental result of a tap.
 */
function ExpandableRow({ requirement }: { requirement: Requirement }) {
  const [open, setOpen] = React.useState(false)
  const { label, state, value, progress, detail, href } = requirement
  const tone = REQ_TONE[state]
  const Icon = STATE_ICON[state]
  const hasDetail = (detail?.length ?? 0) > 0

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={hasDetail ? open : undefined}
        disabled={!hasDetail}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg py-1.5 text-left transition-colors",
          hasDetail && "hover:bg-[var(--on-glass-fill-soft)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <Icon className={cn("h-3.5 w-3.5 shrink-0", tone.icon)} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-xs text-foreground">{label}</span>
        {/* Only where it says something. An `ok` document sits at nearly zero
            against its warning window, so its meter is an empty track next to a
            day count that already answered the question — four of those in a
            column is just noise. */}
        {progress !== undefined && state !== "ok" && (
          <span className={cn("h-1 w-10 shrink-0 overflow-hidden rounded-full", tone.track)}>
            <span
              className={cn("block h-full rounded-full", tone.fill)}
              style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
            />
          </span>
        )}
        <span className="w-12 shrink-0 text-right text-xs font-semibold tabular-nums text-foreground">
          {value}
        </span>
        {hasDetail && (
          <ChevronRight
            className={cn(
              "h-3 w-3 shrink-0 text-muted-foreground/50 transition-transform duration-200 motion-reduce:transition-none",
              open && "rotate-90",
            )}
            aria-hidden="true"
          />
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && hasDetail && (
          <motion.div
            key="detail"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={EXPAND}
            className="overflow-hidden"
          >
            {/* Indented under the row's own label (the icon's width plus its
                gap), and a real two-column grid so every value lines up in a
                column instead of landing wherever its label's length left it. */}
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 pb-2 pl-[1.375rem] pt-0.5">
              {detail?.map((d) => (
                <React.Fragment key={d.label}>
                  <dt className="text-[11px] text-muted-foreground/70">{d.label}</dt>
                  <dd className="text-[11px] font-medium tabular-nums text-foreground/90">
                    {d.value}
                  </dd>
                </React.Fragment>
              ))}
              <dd className="col-span-2">
                <Link
                  href={href}
                  className="mt-0.5 inline-flex w-fit items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                >
                  Open
                  <ArrowUpRight className="h-3 w-3" />
                </Link>
              </dd>
            </dl>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
