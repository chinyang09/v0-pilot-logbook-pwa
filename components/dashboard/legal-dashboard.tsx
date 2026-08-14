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
import { tzFormatter, tzOffsetName } from "@/lib/utils/tz-format"
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
 * A 1Hz clock, gated on this being the tab on screen.
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
  // flight history. The range is irrelevant to it — recency is always computed
  // over the full history.
  const { aggregates, isLoading: aggLoading } = useDashboardAggregates({
    fromIso: "1970-01-01",
    toIso: "9999-12-31",
  })
  const { status, isLoading: statusLoading } = usePilotStatus(
    aggregates.ninetyDayCurrency,
    now,
  )

  if (aggLoading || statusLoading) {
    return <Skeleton className={cn("h-full min-h-[24rem] rounded-3xl", className)} />
  }

  return <LegalDashboardView status={status} now={now} className={className} />
}

/** The presentational half — pure props, so it renders without the database. */
export function LegalDashboardView({
  status,
  now,
  className,
}: {
  status: PilotStatus
  now: number
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
        <HeaderStrip status={status} now={now} />
        <Annunciator status={status} now={now} />
        <DutyBand status={status} now={now} />
        <CurrencyBand requirements={currency} />
        <LimitsBand requirements={limits} />
      </div>
    </div>
  )
}

/* ── Header ──────────────────────────────────────────────────────────────── */

function HeaderStrip({ status, now }: { status: PilotStatus; now: number }) {
  // The device's own zone: a pilot reads their watch, and the app has no better
  // claim to know which base they are acclimatised to.
  const zone = React.useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])
  const at = new Date(now)
  const date = tzFormatter(zone, { day: "2-digit", month: "short" }, "daymon")
    .format(at)
    .toUpperCase()
  const time = tzFormatter(zone, { hour: "2-digit", minute: "2-digit", hour12: false }, "hm").format(at)
  const offset = tzOffsetName(zone, "shortOffset", at)

  const phase =
    status.duty.phase === "on_duty"
      ? "ON DUTY"
      : status.duty.phase === "post_duty"
        ? "OFF BLOCKS"
        : "OFF DUTY"

  return (
    <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
      <span
        className="text-[11px] font-medium tabular-nums tracking-wide text-muted-foreground"
        suppressHydrationWarning
      >
        {date}
        <span className="mx-1.5 text-muted-foreground/40">·</span>
        <span className="text-foreground" suppressHydrationWarning>
          {time}
        </span>
        <span className="ml-1 text-muted-foreground/60" suppressHydrationWarning>
          {offset}
        </span>
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
        {phase}
      </span>
    </div>
  )
}

/* ── Master annunciator ──────────────────────────────────────────────────── */

function Annunciator({ status, now }: { status: PilotStatus; now: number }) {
  const tone = TONE[status.state]
  const StateIcon = tone.icon

  // While rest is outstanding the headline IS the countdown — the one thing on
  // the page changing second to second, and the thing being waited on.
  const restMs = status.legalAtUtc ? Date.parse(status.legalAtUtc) - now : 0
  const counting = restMs > 0

  return (
    <div className="px-4 pb-3.5 pt-1">
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
        {counting ? formatCountdown(restMs) : status.nextAction.headline}
      </p>

      {/* The tightest constraint — never "12 / 12 current". When nothing is
          flagged this is the nearest EXPIRY, not the fullest rolling limit: a
          limit refills, so 41% of a 12-month allowance is not "tight". */}
      {status.governing && (
        <p className="mt-1 text-xs leading-tight text-muted-foreground">
          {counting ? "rest remaining · " : ""}
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

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
}

/* ── Duty ────────────────────────────────────────────────────────────────── */

/**
 * The duty band, and the one place the regulatory nuance shows.
 *
 * The maximum is whatever CAAS Reg 14 produced for THIS duty — report time,
 * sectors, crew complement and acclimatisation already applied — and the table
 * that produced it is printed beside it. A fixed "/ 13:00" would be wrong for
 * most duties: an 04:00 report on four sectors and a 10:00 report on two do not
 * share a limit. With no computed maximum the band says so rather than
 * inventing one; a default is a number somebody might fly to.
 *
 * The ROLLING limits used to be printed here as well as in their own band. They
 * are gone from here — that was the duplication.
 */
function DutyBand({ status, now }: { status: PilotStatus; now: number }) {
  const { phase, active, justFinished, next, rest } = status.duty
  const duty = active ?? justFinished

  const onDuty = phase === "on_duty" && active !== null
  const elapsed = onDuty ? Math.max(0, Math.floor((now - active.startMs) / 60_000)) : null
  const hasMax = (duty?.maxFdpMinutes ?? 0) > 0
  const remaining = onDuty && hasMax ? Math.max(0, active.maxFdpMinutes - (elapsed ?? 0)) : 0
  const fraction = onDuty && hasMax ? (elapsed ?? 0) / active.maxFdpMinutes : 0

  return (
    <section className="px-4 py-3" aria-label="Duty">
      <div className="flex items-center gap-4">
        {onDuty && hasMax ? (
          <DutyGauge
            fraction={fraction}
            tone={active.exceeded ? "fail" : fraction >= 0.8 ? "caution" : "ok"}
            value={formatDutyClock(remaining)}
            caption="left"
          />
        ) : (
          <RestGauge status={status} now={now} rest={rest} />
        )}

        <dl className="min-w-0 flex-1 space-y-1">
          {onDuty ? (
            <>
              <Line label="Elapsed" value={formatDutyClock(elapsed ?? 0)} live />
              <Line
                label="Max FDP"
                value={hasMax ? formatDutyClock(active.maxFdpMinutes) : "—"}
                note={
                  hasMax
                    ? [active.fdpTable && `Table ${active.fdpTable}`, active.augmented && "Aug"]
                        .filter(Boolean)
                        .join(" · ")
                    : "not computed"
                }
              />
              <Line label="Flight" value={formatDutyClock(active.flightMinutes)} />
            </>
          ) : (
            <>
              <Line
                label={phase === "post_duty" ? "Last duty" : "Next report"}
                value={
                  phase === "post_duty" && justFinished
                    ? formatDutyClock(
                        Math.max(0, Math.floor((justFinished.endMs - justFinished.startMs) / 60_000)),
                      )
                    : next
                      ? formatDutyClock(Math.max(0, Math.round((next.reportMs - now) / 60_000)))
                      : "—"
                }
                live
              />
              {next ? (
                <Line label="Then" value={`${next.sectorCount} sectors`} note={next.route} />
              ) : (
                <Line label="Roster" value="Clear" />
              )}
              {rest && (
                <Line
                  label="Rest"
                  value={rest.isLegalNow ? "Complete" : formatDutyClock(Math.max(0, rest.requiredMinutes - rest.elapsedMinutes))}
                  note={rest.isLegalNow ? undefined : "to go"}
                />
              )}
            </>
          )}
        </dl>
      </div>

      {/* The sector chain. A duty is up to four legs across several airports, and
          "where am I in the pattern" is what the old recent-flights list could
          never answer — it showed history, not this duty. */}
      <SectorChain legs={duty?.legs ?? []} nextRoute={!duty ? next?.route : undefined} />
    </section>
  )
}

/**
 * The FDP gauge. This is a genuine ratio against a genuine limit — elapsed
 * against the maximum computed for this duty — which is precisely the case an
 * arc is for, and why the period-hours ring on the summary page is not one.
 */
const GAUGE_TONE = {
  ok: { arc: "stroke-chart-2", track: "stroke-chart-2/15" },
  caution: { arc: "stroke-chart-4", track: "stroke-chart-4/15" },
  fail: { arc: "stroke-destructive", track: "stroke-destructive/15" },
  idle: { arc: "stroke-muted-foreground/40", track: "stroke-muted" },
} as const

function DutyGauge({
  fraction,
  tone,
  value,
  caption,
}: {
  fraction: number
  /**
   * Stated, never derived from the fraction. A nearly-full FDP ring is a
   * warning; a nearly-full REST ring is good news — deriving the colour from
   * how full the arc is painted a fully-rested pilot amber.
   */
  tone: keyof typeof GAUGE_TONE
  value: string
  caption: string
}) {
  const size = 92
  const stroke = 7
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const clamped = Math.min(1, Math.max(0, fraction))
  const { arc: color, track } = GAUGE_TONE[tone]

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className={track} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamped)}
          className={cn(color, "transition-[stroke-dashoffset] duration-700 motion-reduce:transition-none")}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="text-xl font-semibold leading-none tabular-nums text-foreground"
          suppressHydrationWarning
        >
          {value}
        </span>
        <span className="mt-0.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
          {caption}
        </span>
      </div>
    </div>
  )
}

/** Off duty, the gauge measures rest served rather than FDP burned. */
function RestGauge({
  status,
  now,
  rest,
}: {
  status: PilotStatus
  now: number
  rest: PilotStatus["duty"]["rest"]
}) {
  if (!rest) {
    return <DutyGauge fraction={0} tone="idle" value="—" caption="off duty" />
  }
  const restMs = status.legalAtUtc ? Date.parse(status.legalAtUtc) - now : 0
  const legal = restMs <= 0
  const served = rest.requiredMinutes > 0 ? rest.elapsedMinutes / rest.requiredMinutes : 1

  return (
    <DutyGauge
      fraction={legal ? 1 : served}
      // Rest served is progress TOWARD legality, so a full ring is green and a
      // partial one is the amber of something still outstanding.
      tone={legal ? "ok" : "caution"}
      // Hours and minutes only. Slicing the h:mm:ss countdown to fit left
      // "9:00:" on the gauge — a trailing colon reads as a truncation bug.
      value={legal ? "Ready" : formatDutyClock(Math.round(restMs / 60_000))}
      caption={legal ? "rested" : "to go"}
    />
  )
}

function Line({
  label,
  value,
  note,
  live,
}: {
  label: string
  value: string
  note?: string
  live?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="shrink-0 text-[11px] text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-baseline gap-1.5">
        {note && <span className="truncate text-[10px] text-muted-foreground/70">{note}</span>}
        <span
          className="text-sm font-semibold tabular-nums text-foreground"
          suppressHydrationWarning={live}
        >
          {value}
        </span>
      </dd>
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
      <div className="space-y-2">
        {pairs.map((pair) => (
          <div key={pair.label} className="flex items-start gap-3">
            <span className="w-10 shrink-0 pt-[3px] text-[11px] font-medium text-muted-foreground">
              {pair.label}
            </span>
            <div className="min-w-0 flex-1 space-y-1.5">
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

function LimitRow({ requirement }: { requirement: Requirement }) {
  const tone = REQ_TONE[requirement.state]
  const Icon = STATE_ICON[requirement.state]
  // "Duty 14d" → "14d": the pair's label already says which measure it is.
  const window = requirement.label.split(" ").slice(-1)[0]

  return (
    <div className="flex items-center gap-2">
      <span className="w-7 shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground/70">
        {window}
      </span>
      <span className={cn("h-1 min-w-0 flex-1 overflow-hidden rounded-full", tone.track)}>
        <span
          className={cn("block h-full rounded-full", tone.fill)}
          style={{ width: `${Math.min(100, Math.max(0, (requirement.progress ?? 0) * 100))}%` }}
        />
      </span>
      {requirement.state !== "ok" && (
        <Icon className={cn("h-3 w-3 shrink-0", tone.icon)} aria-hidden="true" />
      )}
      <span className="shrink-0 text-[11px] font-semibold tabular-nums text-foreground">
        {requirement.value}
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
        "px-4 py-3",
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
            <div className="flex flex-col gap-0.5 pb-2 pl-5.5 pt-0.5">
              {detail?.map((line) => (
                <span key={line} className="text-[11px] tabular-nums text-muted-foreground">
                  {line}
                </span>
              ))}
              <Link
                href={href}
                className="mt-1 inline-flex w-fit items-center gap-1 text-[11px] font-medium text-primary hover:underline"
              >
                Open
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
