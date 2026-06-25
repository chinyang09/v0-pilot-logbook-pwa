"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowUpRight, Plane, Sun, Moon } from "lucide-react"

import { useDashboardPeriod } from "@/hooks/use-dashboard-period"
import { formatDecimalHours } from "@/lib/utils/dashboard-aggregate"
import { cn } from "@/lib/utils"

interface HeroTotalsWidgetProps {
  /** Block time — chocks-off to chocks-on. Airlines log this as "flight time". */
  blockMinutes: number
  simMinutes: number
  flightCount: number
  dayMinutes: number
  nightMinutes: number
  /** Used as the ring's max so the ring fills meaningfully on small periods. */
  periodTargetMinutes?: number
  className?: string
}

export function HeroTotalsWidget({
  blockMinutes,
  simMinutes,
  flightCount,
  dayMinutes,
  nightMinutes,
  periodTargetMinutes,
  className,
}: HeroTotalsWidgetProps) {
  const { resolved } = useDashboardPeriod()

  const max = Math.max(periodTargetMinutes ?? 100 * 60, blockMinutes, 1)
  const ratio = Math.min(1, blockMinutes / max)

  const size = 156
  const stroke = 10
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r

  return (
    <Link
      href="/logbook"
      aria-label={`View logbook for ${resolved.rangeLabel}`}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-card/90 via-card/70 to-card/40 p-3 sm:p-4 shadow-sm backdrop-blur-sm",
        "transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <div className="flex w-full items-center justify-between text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 font-medium uppercase tracking-wider">
          <Plane className="h-3 w-3" />
          {resolved.rangeLabel}
        </span>
        <ArrowUpRight className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
      </div>

      <div className="my-3 flex justify-center">
        <div className="relative">
          <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            className="-rotate-90"
            aria-hidden="true"
          >
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              strokeWidth={stroke}
              className="stroke-muted/40"
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={c * (1 - ratio)}
              className="stroke-chart-2 transition-[stroke-dashoffset] duration-500 motion-reduce:transition-none"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-chart-2">
              Flight
            </p>
            <p className=" tabular-nums text-3xl font-bold text-foreground leading-none">
              {formatDecimalHours(blockMinutes)}
            </p>
            <div className="my-1 h-px w-10 bg-border/80" />
            <p className="text-[10px] font-semibold uppercase tracking-wider text-chart-4">
              Sim
            </p>
            <p className=" tabular-nums text-base font-semibold text-foreground/90 leading-none">
              {formatDecimalHours(simMinutes)}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <StatTile label="Flights" value={String(flightCount)} />
        <StatTile
          label="Day"
          value={formatDecimalHours(dayMinutes)}
          icon={<Sun className="h-3 w-3 text-chart-4" />}
        />
        <StatTile
          label="Night"
          value={formatDecimalHours(nightMinutes)}
          icon={<Moon className="h-3 w-3 text-chart-3" />}
        />
      </div>
    </Link>
  )
}

function StatTile({
  label,
  value,
  icon,
}: {
  label: string
  value: string
  icon?: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-border/40 bg-background/40 px-2 py-1.5 text-center">
      <p className="flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className=" tabular-nums text-sm font-semibold text-foreground">
        {value}
      </p>
    </div>
  )
}
