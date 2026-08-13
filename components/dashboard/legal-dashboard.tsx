"use client"

import * as React from "react"
import Link from "next/link"
import { Check, TriangleAlert, OctagonAlert, ChevronRight } from "lucide-react"

import { usePilotStatus } from "@/hooks/data/use-pilot-status"
import { usePageActive } from "@/hooks/use-page-active"
import { useDashboardAggregates } from "@/hooks/data/use-dashboard-aggregates"
import { formatDutyClock } from "@/lib/utils/dashboard/duty-status"
import { ANNUNCIATOR_WORD, type AnnunciatorState } from "@/lib/utils/dashboard/pilot-status"
import type { PilotStatus } from "@/lib/utils/dashboard/pilot-status"
import type { Requirement, RequirementState } from "@/lib/utils/dashboard/legality"
import { tzFormatter, tzOffsetName } from "@/lib/utils/tz-format"
import { formatDecimalHours, type PeriodFlight } from "@/lib/utils/dashboard-aggregate"
import { formatYMDShort } from "@/lib/utils/date"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/**
 * The legal dashboard — one screen, no scroll, read like an instrument.
 *
 * It answers four questions in the order a pilot asks them on opening the app:
 * am I current, what do I need to do, where am I in my duty, what did I just
 * fly. Everything else is one tap away.
 *
 * **ONE CONTINUOUS SURFACE, not a stack of cards.** Six glass cards with their
 * own borders, radii and 12px margins spend roughly 120px of a phone's height
 * on separation alone, which is the difference between this fitting and not.
 * The sections are separated by hairline rules inside a single surface — the
 * same thing an EFB page does, and the reason it can be dense without being
 * noisy.
 *
 * The height budget on a 390×844 phone, after `--chrome-top` and
 * `--chrome-bottom`, is about 716px. It is spent roughly: status 96, duty 104,
 * requirements 210, recent 96, rules and padding 60. `min-h-0` on the two
 * list sections means an unusually long set compresses rather than pushing the
 * page into a scroll — and the page CAN scroll if it truly has to (a large
 * accessibility text size, a landscape phone), because clipping a legality
 * readout is worse than scrolling one.
 */

const STATE_ICON: Record<RequirementState, React.ComponentType<{ className?: string }>> = {
  ok: Check,
  caution: TriangleAlert,
  fail: OctagonAlert,
  unknown: TriangleAlert,
}

/**
 * The ECAM ramp. Green nominal, amber attention, red action — and every one
 * ships with its own icon, because on this page more than any other the state
 * must survive a colour-blind reader and a sunlit screen.
 */
const ANNUNCIATOR_TONE: Record<
  AnnunciatorState,
  { text: string; dot: string; wash: string; icon: React.ComponentType<{ className?: string }> }
> = {
  current: { text: "text-chart-2", dot: "bg-chart-2", wash: "bg-chart-2/10", icon: Check },
  warning: { text: "text-chart-4", dot: "bg-chart-4", wash: "bg-chart-4/10", icon: TriangleAlert },
  action_required: {
    text: "text-destructive",
    dot: "bg-destructive",
    wash: "bg-destructive/10",
    icon: OctagonAlert,
  },
}

const REQ_TONE: Record<RequirementState, { icon: string; fill: string; track: string }> = {
  ok: { icon: "text-chart-2", fill: "bg-chart-2", track: "bg-chart-2/15" },
  caution: { icon: "text-chart-4", fill: "bg-chart-4", track: "bg-chart-4/15" },
  fail: { icon: "text-destructive", fill: "bg-destructive", track: "bg-destructive/15" },
  unknown: { icon: "text-muted-foreground", fill: "bg-muted-foreground", track: "bg-muted" },
}

/** How many recent sectors the page lists. Three is what fits and what a pilot
 *  is actually checking — "did the last trip land in my logbook". */
const RECENT_SECTORS = 3

/**
 * A 1Hz clock, gated on this being the tab on screen.
 *
 * The dashboard is keep-alive — mounted on first visit and never unmounted —
 * so an ungated interval re-renders this panel every second for the rest of
 * the session while the user is somewhere else entirely. Unlike the previous
 * dashboard's countdown this one always has something to tick (the header
 * clock), so the gate is visibility alone.
 *
 * Every readout it drives is marked `suppressHydrationWarning`. This page is a
 * client component but Next still renders it on the server, and a clock read
 * there can NEVER match the one read a moment later in the browser — without
 * the marker React treats that as a corrupted tree and regenerates it, which is
 * a real error in the console and a discarded first paint. Timestamps are the
 * case the attribute exists for; it is scoped to the three text nodes that are
 * genuinely time-dependent, never to a whole subtree.
 */
function useTick(active: boolean): number {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (!active) return
    const tick = () => setNow(Date.now())
    const first = window.setTimeout(tick, 0)
    const id = window.setInterval(tick, 1000)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(id)
    }
  }, [active])
  return now
}

export function LegalDashboard({ className }: { className?: string }) {
  const isActive = usePageActive("/")
  const now = useTick(isActive)

  // Recency comes off the dashboard aggregate rather than a second walk of the
  // flight history. The range is irrelevant to it — it is always computed over
  // the full history — but the same call supplies the recent sectors, so it is
  // asked for a window wide enough to hold them.
  const { aggregates, isLoading: aggLoading } = useDashboardAggregates({
    fromIso: "1970-01-01",
    toIso: "9999-12-31",
  })
  const { status, isLoading: statusLoading } = usePilotStatus(
    aggregates.ninetyDayCurrency,
    now,
  )

  if (aggLoading || statusLoading) {
    return <Skeleton className={cn("h-full min-h-[24rem] rounded-2xl", className)} />
  }

  return (
    <LegalDashboardView
      status={status}
      recent={aggregates.periodFlights.slice(0, RECENT_SECTORS)}
      now={now}
      className={className}
    />
  )
}

/** The presentational half — pure props, so it renders without the database. */
export function LegalDashboardView({
  status,
  recent,
  now,
  className,
}: {
  status: PilotStatus
  recent: PeriodFlight[]
  now: number
  className?: string
}) {
  const tone = ANNUNCIATOR_TONE[status.state]
  const StateIcon = tone.icon

  return (
    <div
      className={cn(
        // ONE surface. `divide-y` hairlines instead of six bordered cards.
        //
        // `max-h-full`, NOT `h-full`: stretching the surface to the viewport
        // makes the one `flex-1` section absorb every spare pixel, which on a
        // tall phone left ~200px of empty grid below the last requirement. Sized
        // to its content it ends where the content ends, and the cap plus the
        // scrollable requirements block is what handles the other direction.
        "@container flex max-h-full flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/70 shadow-sm",
        "divide-y divide-border/50",
        className,
      )}
    >
      <HeaderStrip status={status} now={now} />
      <Annunciator status={status} tone={tone} icon={StateIcon} now={now} />
      <DutyBlock status={status} now={now} />
      <RequirementsBlock requirements={status.legality.requirements} />
      <RecentBlock flights={recent} />
    </div>
  )
}

/* ── Header ──────────────────────────────────────────────────────────────── */

function HeaderStrip({ status, now }: { status: PilotStatus; now: number }) {
  // The device's own zone: a pilot reads their watch, and the app has no better
  // claim to know which base they are acclimatised to.
  const zone = React.useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  )
  const at = new Date(now)
  const date = tzFormatter(zone, { day: "2-digit", month: "short" }, "daymon")
    .format(at)
    .toUpperCase()
  const time = tzFormatter(
    zone,
    { hour: "2-digit", minute: "2-digit", hour12: false },
    "hm",
  ).format(at)
  const offset = tzOffsetName(zone, "shortOffset", at)

  const route =
    status.duty.active?.route || status.duty.justFinished?.route || status.duty.next?.route

  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 text-[11px]">
      {/* Every node here is marked, not just the wrapper: the attribute applies
          to the element it is on and does NOT inherit. The offset name is the
          one that actually bites — Node's ICU renders "GMT" where the browser
          renders "GMT+0" for the same zone, so this mismatches in production
          even when the clock value agrees. */}
      <span className="tabular-nums text-muted-foreground" suppressHydrationWarning>
        {date} ·{" "}
        <span className="text-foreground" suppressHydrationWarning>
          {time}
        </span>{" "}
        <span className="text-muted-foreground/70" suppressHydrationWarning>
          {offset}
        </span>
      </span>
      {route && (
        <span className="truncate font-medium tabular-nums text-foreground">{route}</span>
      )}
    </div>
  )
}

/* ── Master annunciator ──────────────────────────────────────────────────── */

function Annunciator({
  status,
  tone,
  icon: StateIcon,
  now,
}: {
  status: PilotStatus
  tone: (typeof ANNUNCIATOR_TONE)[AnnunciatorState]
  icon: React.ComponentType<{ className?: string }>
  now: number
}) {
  // While rest is outstanding the headline IS the countdown — it is the one
  // thing on the page that changes second to second and the thing being waited
  // on.
  const restMs = status.legalAtUtc ? Date.parse(status.legalAtUtc) - now : 0
  const counting = restMs > 0

  return (
    <Link
      href={status.nextAction.href}
      className={cn(
        "group flex items-center gap-3 px-3 py-2.5 transition-colors",
        tone.wash,
        "hover:bg-[var(--on-glass-fill-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
      )}
    >
      <StateIcon className={cn("h-6 w-6 shrink-0", tone.text)} aria-hidden="true" />

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-[13px] font-bold uppercase leading-none tracking-[0.08em]",
            tone.text,
          )}
        >
          {ANNUNCIATOR_WORD[status.state]}
        </p>
        {/* The imperative — what to DO. The most valuable line on the screen,
            and the one a data-oriented dashboard never prints. */}
        <p
          className="mt-1 truncate text-sm font-semibold leading-tight text-foreground"
          suppressHydrationWarning
        >
          {counting ? formatCountdown(restMs) : status.nextAction.headline}
        </p>
        {/* The tightest constraint. Never "12 / 12 current" — a pilot does not
            need to be told about the eleven that are fine. */}
        {status.governing && (
          <p className="mt-0.5 truncate text-[11px] leading-tight text-muted-foreground">
            {counting ? "rest remaining · " : ""}
            Tightest: {status.governing.label} {status.governing.value}
          </p>
        )}
      </div>

      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  )
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
}

/* ── Duty ────────────────────────────────────────────────────────────────── */

/**
 * The duty block, and the one place the regulatory nuance actually shows.
 *
 * The maximum is whatever CAAS Reg 14 produced for THIS duty — report time,
 * sectors, crew complement and acclimatisation already applied — and the table
 * that produced it is printed beside it. A fixed "/ 13:00" would be wrong for
 * most duties: an 04:00 report on four sectors and a 10:00 report on two do not
 * share a limit.
 *
 * When the duty carries no computed maximum the block says so rather than
 * inventing one. A dash is honest; a default is a number somebody might fly to.
 */
function DutyBlock({ status, now }: { status: PilotStatus; now: number }) {
  const { phase, active, justFinished, next } = status.duty

  if (phase === "on_duty" && active) {
    // Elapsed is recomputed from the clock rather than read off the model, so
    // it advances with the header time instead of on the model's minute bucket.
    const elapsed = Math.max(0, Math.floor((now - active.startMs) / 60_000))
    const hasMax = active.maxFdpMinutes > 0
    const remaining = hasMax ? Math.max(0, active.maxFdpMinutes - elapsed) : 0
    const fraction = hasMax ? elapsed / active.maxFdpMinutes : 0

    return (
      <section className="px-3 py-2.5" aria-label="Duty in progress">
        <SectionLabel>
          Duty
          {active.fdpTable && <Chip>Table {active.fdpTable}</Chip>}
          {active.augmented && <Chip>Augmented</Chip>}
          {active.sectorCount > 0 && <Chip>{active.sectorCount} sectors</Chip>}
        </SectionLabel>

        <div className="mt-1 flex items-end justify-between gap-3">
          <Figure value={formatDutyClock(elapsed)} label="Elapsed" />
          <Figure
            value={hasMax ? formatDutyClock(remaining) : "—"}
            label={hasMax ? `FDP left · max ${formatDutyClock(active.maxFdpMinutes)}` : "No FDP limit computed"}
            align="right"
            tone={active.exceeded ? "text-destructive" : undefined}
          />
        </div>

        {hasMax && (
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-chart-2/15">
            <div
              className={cn(
                "h-full rounded-full",
                active.exceeded ? "bg-destructive" : fraction >= 0.8 ? "bg-chart-4" : "bg-chart-2",
              )}
              style={{ width: `${Math.min(100, fraction * 100)}%` }}
            />
          </div>
        )}

        <RollingLine status={status} flightMinutes={active.flightMinutes} />
      </section>
    )
  }

  // Off duty (or just finished). The question has changed from "how much have
  // I got left" to "when may I go again", so the block answers that instead of
  // showing an FDP meter that has stopped moving.
  return (
    <section className="px-3 py-2.5" aria-label="Duty">
      <SectionLabel>
        {phase === "post_duty" ? "Last duty" : "Duty"}
        {phase === "post_duty" && justFinished?.sectorCount ? (
          <Chip>{justFinished.sectorCount} sectors</Chip>
        ) : null}
      </SectionLabel>

      <div className="mt-1 flex items-end justify-between gap-3">
        {phase === "post_duty" && justFinished ? (
          <Figure
            value={formatDutyClock(
              Math.max(0, Math.floor((justFinished.endMs - justFinished.startMs) / 60_000)),
            )}
            label={justFinished.route || "Complete"}
          />
        ) : (
          <Figure value="Off" label="Not on duty" />
        )}

        {next ? (
          <Figure
            value={formatDutyClock(Math.max(0, Math.round((next.reportMs - now) / 60_000)))}
            label="To next report"
            align="right"
          />
        ) : (
          <Figure value="—" label="Nothing rostered" align="right" />
        )}
      </div>

      <RollingLine status={status} />
    </section>
  )
}

/**
 * The rolling statutory caps, as a sub-line rather than four meters.
 *
 * These are CAAS Reg 12 (duty) and Reg 107 (flight): 14-day and 28-day duty,
 * 28-day and 12-month flight. There is deliberately NO 7-day figure — CAAS does
 * not impose one, and printing a limit the regulation does not contain is worse
 * than printing none.
 */
function RollingLine({
  status,
  flightMinutes,
}: {
  status: PilotStatus
  flightMinutes?: number
}) {
  const rows = status.legality.requirements.filter((r) => r.group === "limits")

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] tabular-nums">
      {flightMinutes !== undefined && flightMinutes > 0 && (
        <span className="text-muted-foreground">
          FT <span className="font-semibold text-foreground">{formatDutyClock(flightMinutes)}</span>
        </span>
      )}
      {rows.map((r) => {
        const Icon = STATE_ICON[r.state]
        return (
          <span key={r.id} className="inline-flex items-center gap-1 text-muted-foreground">
            {r.state !== "ok" && (
              <Icon className={cn("h-2.5 w-2.5", REQ_TONE[r.state].icon)} aria-hidden="true" />
            )}
            {r.label} <span className="font-semibold text-foreground">{r.value}</span>
          </span>
        )
      })}
    </div>
  )
}

/* ── Requirements ────────────────────────────────────────────────────────── */

/**
 * Every standing requirement, MOST PRESSING FIRST.
 *
 * Sorted rather than grouped: on a no-scroll operational page the top-left row
 * should always be the thing closest to stopping the pilot, which is the same
 * thing the annunciator's "tightest" line names. Group headings would cost four
 * rules and ~56px to impose an order nobody is reading for.
 */
function RequirementsBlock({ requirements }: { requirements: Requirement[] }) {
  const ordered = React.useMemo(() => {
    const rank: Record<RequirementState, number> = { fail: 0, caution: 1, unknown: 2, ok: 3 }
    return [...requirements].sort(
      (a, b) => rank[a.state] - rank[b.state] || (b.urgency ?? 0) - (a.urgency ?? 0),
    )
  }, [requirements])

  return (
    <section className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5 scrollbar-hide" aria-label="Requirements">
      <SectionLabel>Currency &amp; limits</SectionLabel>
      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1.5 @[26rem]:grid-cols-3 @[40rem]:grid-cols-4 @[56rem]:grid-cols-6">
        {ordered.map((r) => (
          <RequirementCell key={r.id} requirement={r} />
        ))}
      </div>
    </section>
  )
}

function RequirementCell({ requirement }: { requirement: Requirement }) {
  const { label, state, value, progress, href } = requirement
  const tone = REQ_TONE[state]
  const Icon = STATE_ICON[state]

  return (
    <Link
      href={href}
      className="group flex min-w-0 flex-col gap-1 rounded-md py-0.5 transition-colors hover:bg-[var(--on-glass-fill-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <Icon className={cn("h-3 w-3 shrink-0", tone.icon)} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
          {label}
        </span>
        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-foreground">
          {value}
        </span>
      </span>
      <span className={cn("block h-[2px] w-full overflow-hidden rounded-full", tone.track)}>
        {progress !== undefined && (
          <span
            className={cn("block h-full rounded-full", tone.fill)}
            style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
          />
        )}
      </span>
    </Link>
  )
}

/* ── Recent ──────────────────────────────────────────────────────────────── */

/**
 * The last few sectors, at their most compact — date, pair, block.
 *
 * No registration, type, role or OOOI here. This block exists to answer "did
 * what I just flew reach my logbook", and everything else is one tap away on
 * the summary page or the flight itself.
 */
function RecentBlock({ flights }: { flights: PeriodFlight[] }) {
  return (
    <section className="px-3 py-2.5" aria-label="Recent sectors">
      {/* The heading is the way to the logbook — which is where a flight is
          created. A second "log flight" control here would be a duplicate of
          the logbook header's, which also selects the new flight into that
          page's detail panel; two code paths for one action. */}
      <Link
        href="/logbook"
        className="group inline-flex items-center gap-1 transition-colors hover:text-foreground"
      >
        <SectionLabel>Recent</SectionLabel>
        <ChevronRight className="h-3 w-3 text-muted-foreground/70" aria-hidden="true" />
      </Link>
      {flights.length === 0 ? (
        <p className="py-1 text-[11px] text-muted-foreground">No flights logged</p>
      ) : (
        <ul className="mt-0.5">
          {flights.map((f) => (
            <li key={f.id}>
              <Link
                href={`/flights/${f.id}`}
                className="flex items-center gap-2 rounded-md py-1 text-[11px] transition-colors hover:bg-[var(--on-glass-fill-soft)]"
              >
                <span className="w-11 shrink-0 tabular-nums text-muted-foreground">
                  {formatYMDShort(f.date)}
                </span>
                <span className="min-w-0 flex-1 truncate tabular-nums text-foreground">
                  {f.departureIata || f.departureIcao || "—"}
                  <span className="text-muted-foreground"> → </span>
                  {f.arrivalIata || f.arrivalIcao || "—"}
                </span>
                <span className="shrink-0 tabular-nums text-foreground">
                  {formatDecimalHours(f.blockMinutes)}h
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/* ── Shared bits ─────────────────────────────────────────────────────────── */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">
      {children}
    </p>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-[var(--on-glass-fill-soft)] px-1.5 py-px text-[9px] font-medium normal-case tracking-normal text-muted-foreground">
      {children}
    </span>
  )
}

/**
 * A large number with a tiny label — the cockpit-instrument reading.
 *
 * `tabular-nums` here, deliberately against the usual rule for big figures:
 * these are CLOCKS that tick, and with proportional digits the whole number
 * shifts sideways every time a 1 becomes a 2.
 */
function Figure({
  value,
  label,
  align,
  tone,
}: {
  value: string
  label: string
  align?: "right"
  tone?: string
}) {
  return (
    <div className={cn("min-w-0", align === "right" && "text-right")}>
      <p
        className={cn("text-2xl font-semibold leading-none tabular-nums text-foreground", tone)}
        suppressHydrationWarning
      >
        {value}
      </p>
      <p className="mt-1 truncate text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
    </div>
  )
}
