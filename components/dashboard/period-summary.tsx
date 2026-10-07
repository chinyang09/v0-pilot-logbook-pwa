"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowUpRight } from "lucide-react"

import { useDashboardPeriod } from "@/hooks/use-dashboard-period"
import { formatDecimalHours } from "@/lib/utils/dashboard-aggregate"
import { cn } from "@/lib/utils"

interface PeriodSummaryProps {
  /** Block time — chocks-off to chocks-on, what an airline logbook records. */
  blockMinutes: number
  simMinutes: number
  flightCount: number
  dayMinutes: number
  nightMinutes: number
  className?: string
}

/**
 * What the selected period came to — as a hero figure, not a ring.
 *
 * The ring this replaces was metered against a hardcoded 100-hour maximum, so
 * its fill meant nothing: 48 hours in a week and 48 hours in a year drew the
 * same arc. A ratio needs a real denominator to be worth drawing. Block hours
 * for a period have no limit, so the honest form is the number itself — one
 * hero figure, the single largest thing on the page.
 *
 * Day and night DO have a denominator (they partition the block time), so they
 * are the one thing here that is drawn: a part-to-whole bar, direct-labelled.
 */
export function PeriodSummary({
  blockMinutes,
  simMinutes,
  flightCount,
  dayMinutes,
  nightMinutes,
  className,
}: PeriodSummaryProps) {
  const { resolved } = useDashboardPeriod()

  const split = dayMinutes + nightMinutes
  const dayPct = split > 0 ? (dayMinutes / split) * 100 : 0

  return (
    <section
      className={cn(
        "@container rounded-3xl border border-border/60 bg-card/70 p-4 shadow-sm",
        className,
      )}
      aria-label="Period totals"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
          {resolved.rangeLabel}
        </p>
        <Link
          href="/logbook"
          className="group inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          Logbook
          <ArrowUpRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
        </Link>
      </div>

      <div className="mt-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        {/* The hero figure. Proportional digits deliberately — `tabular-nums`
            gives every digit the width of a zero, which reads loose at display
            size. Tabular is for columns that must line up, and this is not in
            one. */}
        <div className="flex items-baseline gap-1.5">
          <span className="text-[3.25rem] font-semibold leading-[0.9] tracking-tight text-foreground">
            {formatDecimalHours(blockMinutes)}
          </span>
          <span className="text-sm font-medium text-muted-foreground">h block</span>
        </div>

        <div className="flex items-end gap-4">
          <Stat label="Sectors" value={String(flightCount)} />
          <Stat label="Sim" value={formatDecimalHours(simMinutes)} unit="h" />
        </div>
      </div>

      {/* Day / night — a part-to-whole of the block time above it, so it says
          something the hero figure cannot. The 2px surface gap between the two
          fills is what separates them; there is no stroke around either. */}
      {split > 0 && (
        <div className="mt-3">
          <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-chart-4" style={{ width: `${dayPct}%` }} />
            <div className="w-[2px] shrink-0" />
            <div className="h-full flex-1 rounded-full bg-chart-3" />
          </div>
          <div className="mt-1.5 flex items-center gap-3 text-[11px]">
            <Key className="bg-chart-4" label="Day" value={formatDecimalHours(dayMinutes)} />
            <Key className="bg-chart-3" label="Night" value={formatDecimalHours(nightMinutes)} />
          </div>
        </div>
      )}
    </section>
  )
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="text-right">
      <p className="text-[10px] font-medium text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold leading-tight text-foreground">
        {value}
        {unit && <span className="text-xs font-medium text-muted-foreground">{unit}</span>}
      </p>
    </div>
  )
}

/**
 * The legend for the day/night bar. Two series always get one — identity is
 * never colour alone — and the swatch beside the text is what carries the hue,
 * so the label itself stays on a text token.
 */
function Key({
  className,
  label,
  value,
}: {
  className: string
  label: string
  value: string
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-2 w-2 rounded-full", className)} aria-hidden="true" />
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums text-foreground">{value}</span>
    </span>
  )
}
