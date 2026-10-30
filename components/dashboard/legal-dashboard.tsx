"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Check, TriangleAlert, OctagonAlert, ArrowUpRight, Info, RefreshCw } from "lucide-react"

import { usePilotStatus } from "@/hooks/data/use-pilot-status"
import { usePageActive } from "@/hooks/use-page-active"
import { useFlights } from "@/hooks/data/use-flights"
import { useDayKey } from "@/hooks/use-day-key"
import { ninetyDayRecency } from "@/lib/utils/dashboard-aggregate"
import { formatDutyClock, type SectorLeg } from "@/lib/utils/dashboard/duty-status"
import { ANNUNCIATOR_WORD, type AnnunciatorState } from "@/lib/utils/dashboard/pilot-status"
import type { PilotStatus } from "@/lib/utils/dashboard/pilot-status"
import type { Requirement, RequirementState } from "@/lib/utils/dashboard/legality"
import { formatInstant, tzFormatter } from "@/lib/utils/tz-format"
import { usePreferences } from "@/components/providers/preferences-provider"
import type { DisplayPreferences } from "@/types/db/stores.types"
import { Skeleton } from "@/components/ui/skeleton"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import { useIsDesktop } from "@/hooks/use-is-desktop"
import { RequirementDetailPanel } from "./requirement-detail-panel"
import { DutyFlightsPanel } from "./duty-flights-panel"
import { useDutyLookups } from "@/hooks/use-duty-lookups"
import { describeDuty, type DutyInfo } from "@/lib/utils/dashboard/duty-line"
import { cn } from "@/lib/utils"

/**
 * The legal dashboard — one screen, no scroll, read like an instrument.
 *
 * Four bands, in the order a pilot asks: what is my state and what must I do
 * (the annunciator), where am I in my duty day (the timeline and the sector
 * chain), am I qualified (currency), and how much have I used (limits).
 *
 * **ONE CONTINUOUS SURFACE, not a stack of cards.** Six glass cards with their
 * own borders, radii and 12px margins spend roughly 120px of a phone's height
 * on separation alone, which is the difference between this fitting and not.
 *
 * **Nothing here navigates by default.** A cell opens its DETAIL in the detail
 * panel (the owner's main / detail rule) — beside the page on a tablet, the
 * overlay on a phone, with the dashboard still underneath. It used to unfold
 * under the grid, inside the one surface that has to fit a phone's height.
 * The deep link is in the panel, a deliberate second step.
 *
 * **Currency and limits are separate bands, and that is not cosmetic.** A
 * currency is measured in DAYS and expires; a limit is measured in HOURS and
 * refills. Sorting them into one grid by urgency put a document expiry between
 * two duty-hour rows and split the takeoff and landing halves of one question
 * across the grid — which is exactly the "jumbled" complaint. Now each band
 * holds one kind of thing, and within the duty band the rolling limits are
 * gone entirely: they were printed twice.
 *
 * They also take the SHAPE their content asks for. A currency is a name and a
 * number of days, so the band is a grid of small cells read at a glance; a
 * limit is a fraction of something, so it stays a bar with its figure on it.
 * Forcing one form on both is what the separation exists to avoid.
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
  // Not on the status ramp: nothing has been assessed, so it is neither a
  // pass nor a fail. Neutral, like the `unknown` requirement cell.
  getting_started: {
    text: "text-muted-foreground",
    wash: "bg-muted",
    glow: "from-muted-foreground/[0.08]",
    icon: Info,
  },
}

const REQ_TONE: Record<RequirementState, { icon: string; fill: string; track: string }> = {
  ok: { icon: "text-chart-2", fill: "bg-chart-2", track: "bg-chart-2/15" },
  caution: { icon: "text-chart-4", fill: "bg-chart-4", track: "bg-chart-4/15" },
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

  // Recency on its own — not the whole period aggregate, which built a totals
  // breakdown and a detail row for every flight ever logged to read this one
  // figure. Keyed on the day too: recency is measured against TODAY.
  const { flights, isLoading: aggLoading } = useFlights()
  const dayKey = useDayKey()
  const recency = React.useMemo(
    () => ninetyDayRecency(flights),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dayKey is the "now" input
    [flights, dayKey],
  )
  const { status, isLoading: statusLoading } = usePilotStatus(
    recency,
    now,
    preferences?.display,
  )

  // A requirement opens in the detail panel as `req:<id>`. The id is held,
  // not the requirement, so the model rebuilding every minute refreshes the
  // open panel rather than closing it; a requirement that disappears clears it.
  const { selectedId, setSelectedId, setDetailContent } = useDetailPanel()
  const isDesktop = useIsDesktop()
  const openReqId = selectedId?.startsWith("req:") ? selectedId.slice(4) : null
  const openRequirement = openReqId
    ? status.legality.requirements.find((r) => r.id === openReqId) ?? null
    : null
  // The sector chain opens its duty's flights — gates, the inbound aeroplane —
  // as `duty:<start ms>`, so the one-screen page gains no row for them.
  const openDutyMs = selectedId?.startsWith("duty:") ? Number(selectedId.slice(5)) : null
  const onDashboard = usePathname() === "/"
  React.useEffect(() => {
    // Keep-alive: a hidden dashboard must not write the panel another page
    // owns (the pathname moves a commit before the active-route store does).
    if (!isActive || !onDashboard) return
    if (openDutyMs !== null && Number.isFinite(openDutyMs)) {
      setDetailContent(<DutyFlightsPanel key={openDutyMs} atMs={openDutyMs} />)
      return
    }
    if (!openReqId) return
    setDetailContent(
      openRequirement ? <RequirementDetailPanel key={openRequirement.id} requirement={openRequirement} /> : null,
    )
  }, [isActive, onDashboard, openReqId, openRequirement, openDutyMs, setDetailContent])
  // The duty the chain draws — this one on duty, else the next — with its
  // gates and inbound aeroplane asked by themselves once it is close enough
  // for either to be published, and only while the page is on screen.
  const dutyAtMs =
    status.duty.phase === "on_duty" && status.duty.active ? status.duty.active.startMs : status.duty.next?.reportMs ?? null
  const dutyClose = dutyAtMs !== null && dutyAtMs >= now - DUTY_LOOKUP_WINDOW_MS && dutyAtMs <= now + DUTY_LOOKUP_WINDOW_MS
  const duty = useDutyLookups(dutyClose ? dutyAtMs : null, { active: isActive })
  const dutyInfo = React.useMemo(
    () => (dutyClose && duty.legs.length > 0 ? describeDuty(duty.legs, duty.lookups, duty.loading, duty.refresh, preferences?.display) : undefined),
    [dutyClose, duty.legs, duty.lookups, duty.loading, duty.refresh, preferences?.display],
  )
  const openRequirementCell = React.useCallback((id: string) => setSelectedId(`req:${id}`), [setSelectedId])
  const openDuty = React.useCallback((atMs: number) => setSelectedId(`duty:${atMs}`), [setSelectedId])

  if (aggLoading || statusLoading) {
    return <Skeleton className={cn("h-full min-h-[24rem] rounded-3xl", className)} />
  }

  return (
    <LegalDashboardView
      status={status}
      now={now}
      display={preferences?.display}
      // Lit only where the panel BESIDE the page shows it.
      openRequirementId={isDesktop ? openReqId : null}
      onOpenRequirement={openRequirementCell}
      onOpenDuty={openDuty}
      dutyInfo={dutyInfo}
      className={className}
    />
  )
}

/** How far either side of now a duty's gates and aeroplane are worth asking about. */
const DUTY_LOOKUP_WINDOW_MS = 18 * 3600_000

/** The presentational half — pure props, so it renders without the database. */
export function LegalDashboardView({
  status,
  now,
  display,
  openRequirementId = null,
  onOpenRequirement,
  onOpenDuty,
  dutyInfo,
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
  /** The requirement shown in the detail panel beside the page. */
  openRequirementId?: string | null
  /** Open a requirement's detail. Without it the cells are not buttons. */
  onOpenRequirement?: (id: string) => void
  /** Open the duty the sector chain draws (its start, ms). Without it the chain is not a button. */
  onOpenDuty?: (atMs: number) => void
  /** The chain's duty's gates and inbound aeroplane, when it is close enough to ask. */
  dutyInfo?: DutyInfo
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

      {/* Scrolls only as a LAST RESORT. Everything fits on a phone held
          upright (measured: 360×780 and up), so this never moves there — but a
          phone turned sideways gets the split layout at ~390px tall, and with
          `overflow-hidden` alone the currency band was squeezed to nothing and
          the limits band was clipped off the bottom: a pilot checking legality
          sideways could see neither. */}
      <div className="relative flex min-h-0 flex-col divide-y divide-border/40 overflow-y-auto overscroll-contain scrollbar-hide">
        <Annunciator status={status} />
        <DutyBand status={status} now={now} display={display} onOpenDuty={onOpenDuty} dutyInfo={dutyInfo} />
        <CurrencyBand requirements={currency} openId={openRequirementId} onOpen={onOpenRequirement} />
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
      {/* With nothing logged there is no constraint to name — a rolling limit
          at 0 / 90h is not "tight" — so the line explains the first step. */}
      {status.state === "getting_started" ? (
        <p className="mt-1 text-xs leading-tight text-muted-foreground">
          {status.nextAction.detail}
        </p>
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
  onOpenDuty,
  dutyInfo,
}: {
  status: PilotStatus
  now: number
  display?: DisplayPreferences
  onOpenDuty?: (atMs: number) => void
  dutyInfo?: DutyInfo
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
    <section className="px-4 py-2.5" aria-label="Duty">
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

      {/* The sector chain. A duty is up to four legs across several airports,
          and "where am I in the pattern" is what the old recent-flights list
          could never answer — it showed history, not this duty. On duty it is
          THIS duty's progress; otherwise it is the NEXT duty's shape, which is
          what the footnote above it has just named. */}
      <SectorChain
        legs={view.legs}
        nextRoute={view.nextRoute}
        legGates={dutyInfo?.legGates}
        // The chain draws THIS duty on duty and the NEXT one otherwise, so
        // that is the duty a tap opens.
        onOpen={(() => {
          const atMs = onDuty ? active.startMs : next?.reportMs
          return onOpenDuty && atMs != null ? () => onOpenDuty(atMs) : undefined
        })()}
      />

      {/* The aeroplane for the next leg to fly, and the refresh for it and the
          gates — asked by themselves, never stored, so a later gate is a tap
          away. Only while the duty is close enough to ask about. */}
      {dutyInfo && (
        <div className="mt-2 flex items-center gap-2">
          <p
            title={dutyInfo.line}
            className="min-w-0 flex-1 truncate text-[11px] leading-tight text-muted-foreground"
            suppressHydrationWarning
          >
            {dutyInfo.line}
          </p>
          <button
            type="button"
            onClick={dutyInfo.onRefresh}
            disabled={dutyInfo.loading}
            aria-label="Refresh gates and aircraft"
            className="relative shrink-0 rounded-full p-0.5 text-muted-foreground after:absolute after:-inset-3 after:content-[''] focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", dutyInfo.loading && "animate-spin")} />
          </button>
        </div>
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
function SectorChain({
  legs,
  nextRoute,
  legGates,
  onOpen,
}: {
  legs: SectorLeg[]
  nextRoute?: string
  /** Each leg's gates in order; drawn under the stops when they line up with the chain. */
  legGates?: { dep: string; arr: string }[]
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
        "mt-3 flex w-full items-start",
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

/* ── Currency ────────────────────────────────────────────────────────────── */

/**
 * Everything measured in DAYS — recency and documents, nearest expiry first.
 *
 * It is a GRID of cells, not a column of rows. Each currency is one small fact
 * of the same kind — a name and a number of days — so a set is what they are,
 * and a set laid out two-up reads as one glance rather than as a list with an
 * implied sequence. It is also half the height, which matters: this is the one
 * band that absorbs the squeeze (`flexible`), so every row it does not spend is
 * headroom on a short phone.
 *
 * Sorted most-pressing-first with no headings, so **the top-left cell is always
 * the thing closest to stopping the pilot**. Headings would cost four rules and
 * ~56px to impose an order nobody is reading for.
 *
 * Recency is ONE cell, not two: takeoffs and landings are two halves of one
 * question, and as separate urgency-sorted cells they did not even end up next
 * to each other. Opening the cell shows both counts.
 */
function CurrencyBand({
  requirements,
  openId,
  onOpen,
}: {
  requirements: Requirement[]
  openId: string | null
  onOpen?: (id: string) => void
}) {
  const ordered = React.useMemo(
    () => [...requirements].sort((a, b) => (a.daysUntil ?? 9e9) - (b.daysUntil ?? 9e9)),
    [requirements],
  )

  return (
    <Band label="Currency" requirements={ordered} flexible>
      {/* Nothing to show only happens before anything has been logged or
          added: say where the documents go rather than draw an empty band. */}
      {ordered.length === 0 && (
        <Link
          href="/currencies"
          className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <span>Track your medical, licence and checks</span>
          <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        </Link>
      )}
      <div className="grid grid-cols-2 gap-1.5 @[26rem]:grid-cols-3 @[44rem]:grid-cols-4">
        {ordered.map((r) => (
          <CurrencyCell
            key={r.id}
            requirement={r}
            open={r.id === openId}
            onOpen={onOpen}
          />
        ))}
      </div>
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
        // It absorbs the squeeze, but never below its first row of cells — at
        // min-h-0 it collapsed to its label on a short screen and every
        // currency vanished behind a hidden scrollbar.
        flexible && "min-h-[6.5rem] flex-1 overflow-y-auto scrollbar-hide",
        // On a SHORT screen (a phone held sideways) the whole surface scrolls
        // instead, so this band takes its full height rather than being a
        // second scroller nested inside the first.
        flexible && "[@media(max-height:500px)]:flex-none [@media(max-height:500px)]:overflow-visible",
      )}
      aria-label={label}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
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
          {/* A tick says "everything here is met" — an empty band has
              nothing to have met. */}
          {fail === 0 && caution === 0 && requirements.length > 0 && (
            <Check className="h-3 w-3 text-chart-2" aria-hidden="true" />
          )}
        </span>
      </div>
      {children}
    </section>
  )
}

/**
 * One currency, as a cell.
 *
 * The figure sits above its caption, which is the duty band's `Scale`
 * vocabulary — the two bands are then reading the same way, a number over the
 * word for what it is, rather than each inventing its own arrangement.
 *
 * **Only a FLAGGED cell is tinted.** The status ramp means met / close / not
 * met, and tinting the met ones green as well would paint the whole band and
 * leave the one thing that needs attention with nothing to stand out against.
 * Colour is never the only carrier either: every state ships its own icon.
 */
function CurrencyCell({
  requirement,
  open,
  onOpen,
}: {
  requirement: Requirement
  /** Its detail is in the panel beside the page. */
  open: boolean
  onOpen?: (id: string) => void
}) {
  const { label, state, value, progress, detail } = requirement
  const tone = REQ_TONE[state]
  const Icon = STATE_ICON[state]
  const hasDetail = !!onOpen && (detail?.length ?? 0) > 0
  const flagged = state !== "ok"

  return (
    <button
      type="button"
      onClick={() => onOpen?.(requirement.id)}
      aria-current={open || undefined}
      disabled={!hasDetail}
      className={cn(
        "flex min-w-0 flex-col rounded-lg px-2 py-1.5 text-left transition-colors",
        flagged ? tone.track : "bg-muted/40",
        hasDetail && !open && "hover:brightness-110",
        open && "ring-1 ring-inset ring-foreground/25",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <span className="flex min-w-0 items-center gap-1">
        <Icon className={cn("h-3 w-3 shrink-0", tone.icon)} aria-hidden="true" />
        <span
          className={cn(
            "min-w-0 truncate text-sm font-semibold leading-tight tabular-nums",
            flagged ? tone.icon : "text-foreground",
          )}
        >
          {value}
        </span>
      </span>

      <span className="mt-0.5 block truncate text-[9px] font-medium uppercase leading-tight tracking-wider text-muted-foreground">
        {label}
      </span>

      {/* A meter only where it says something. An `ok` document sits at nearly
          zero against its warning window, so its bar is an empty track beside a
          day count that already answered the question — four of those is noise.
          `mt-auto` keeps the metered and un-metered cells the same height. */}
      {flagged && progress !== undefined && (
        <span className="mt-auto block h-[3px] w-full overflow-hidden rounded-full bg-foreground/10">
          <span
            className={cn("block h-full rounded-full", tone.fill)}
            style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
          />
        </span>
      )}
    </button>
  )
}
