"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowUpRight, Plane } from "lucide-react"

import { useDashboardPeriod } from "@/hooks/use-dashboard-period"
import { formatDecimalHours } from "@/lib/utils/dashboard-aggregate"
import { cn } from "@/lib/utils"

interface HeroTotalsWidgetProps {
  flightMinutes: number
  simMinutes: number
  blockMinutes: number
  flightCount: number
  className?: string
}

export function HeroTotalsWidget({
  flightMinutes,
  simMinutes,
  blockMinutes,
  flightCount,
  className,
}: HeroTotalsWidgetProps) {
  const { resolved } = useDashboardPeriod()
  const total = flightMinutes + simMinutes
  const flightRatio = total > 0 ? flightMinutes / total : 1
  const simRatio = total > 0 ? simMinutes / total : 0

  const size = 220
  const stroke = 12
  const r1 = (size - stroke) / 2
  const r2 = (size - stroke) / 2 - (stroke + 6)
  const c1 = 2 * Math.PI * r1
  const c2 = 2 * Math.PI * r2

  return (
    <Link
      href={`/logbook`}
      aria-label={`View logbook for ${resolved.label}`}
      className={cn(
        "group relative flex flex-col items-center justify-center overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-card/90 via-card/70 to-card/40 p-4 sm:p-6 shadow-sm backdrop-blur-sm",
        "transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <div className="mb-3 flex w-full items-center justify-between text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 font-medium uppercase tracking-wider">
          <Plane className="h-3 w-3" />
          {resolved.label}
        </span>
        <ArrowUpRight className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
      </div>

      <div className="relative flex items-center justify-center">
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
            r={r1}
            fill="none"
            strokeWidth={stroke}
            className="stroke-muted/40"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r1}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c1}
            strokeDashoffset={c1 * (1 - flightRatio)}
            className="stroke-chart-2 transition-[stroke-dashoffset] duration-500 motion-reduce:transition-none"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r2}
            fill="none"
            strokeWidth={stroke}
            className="stroke-muted/40"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r2}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c2}
            strokeDashoffset={c2 * (1 - simRatio)}
            className="stroke-chart-4 transition-[stroke-dashoffset] duration-500 motion-reduce:transition-none"
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-chart-2">
            Flight
          </p>
          <p className="font-mono tabular-nums text-3xl sm:text-4xl font-bold text-foreground leading-none">
            {formatDecimalHours(flightMinutes)}
          </p>
          <div className="mt-2 h-px w-12 bg-border/80" />
          <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-chart-4">
            Sim
          </p>
          <p className="font-mono tabular-nums text-lg font-semibold text-foreground/90 leading-none">
            {formatDecimalHours(simMinutes)}
          </p>
        </div>
      </div>

      <div className="mt-4 grid w-full grid-cols-2 gap-3 text-center">
        <div className="rounded-xl border border-border/40 bg-background/40 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Block
          </p>
          <p className="font-mono tabular-nums text-base font-semibold text-foreground">
            {formatDecimalHours(blockMinutes)}
          </p>
        </div>
        <div className="rounded-xl border border-border/40 bg-background/40 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Flights
          </p>
          <p className="font-mono tabular-nums text-base font-semibold text-foreground">
            {flightCount}
          </p>
        </div>
      </div>
    </Link>
  )
}
