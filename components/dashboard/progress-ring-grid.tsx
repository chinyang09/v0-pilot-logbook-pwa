"use client"

import * as React from "react"
import Link from "next/link"

import { RadialProgress } from "@/components/ui/radial-progress"
import { formatDecimalHours } from "@/lib/utils/dashboard-aggregate"
import { cn } from "@/lib/utils"

interface ProgressRingGridProps {
  xcMinutes: number
  actualIRMinutes: number
  simIRMinutes: number
  dualMinutes: number
  totalFlightMinutes: number
  className?: string
}

interface RingTile {
  label: string
  minutes: number
  href: string
  trackTone: string
  indicatorTone: string
}

export function ProgressRingGrid({
  xcMinutes,
  actualIRMinutes,
  simIRMinutes,
  dualMinutes,
  totalFlightMinutes,
  className,
}: ProgressRingGridProps) {
  const max = Math.max(totalFlightMinutes, 1)
  const tiles: RingTile[] = [
    {
      label: "XC",
      minutes: xcMinutes,
      href: "/logbook",
      trackTone: "stroke-chart-2/15",
      indicatorTone: "stroke-chart-2",
    },
    {
      label: "Actual",
      minutes: actualIRMinutes,
      href: "/logbook",
      trackTone: "stroke-chart-3/15",
      indicatorTone: "stroke-chart-3",
    },
    {
      label: "Sim",
      minutes: simIRMinutes,
      href: "/logbook",
      trackTone: "stroke-chart-4/15",
      indicatorTone: "stroke-chart-4",
    },
    {
      label: "Dual",
      minutes: dualMinutes,
      href: "/logbook",
      trackTone: "stroke-chart-5/15",
      indicatorTone: "stroke-chart-5",
    },
  ]

  return (
    <div
      className={cn(
        "rounded-2xl border border-border/60 bg-card/70 p-3 sm:p-4 shadow-sm backdrop-blur-sm",
        className,
      )}
    >
      <div className="grid grid-cols-4 gap-2 sm:gap-3">
        {tiles.map((tile) => {
          const pct = max > 0 ? Math.round((tile.minutes / max) * 100) : 0
          return (
            <Link
              key={tile.label}
              href={tile.href}
              className="group flex flex-col items-center gap-1 rounded-xl p-1 transition-colors hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`${tile.label} hours`}
            >
              <RadialProgress
                value={tile.minutes}
                max={max}
                size={64}
                strokeWidth={6}
                trackClassName={tile.trackTone}
                indicatorClassName={tile.indicatorTone}
              >
                <span className="font-mono tabular-nums text-[11px] font-semibold text-foreground">
                  {formatDecimalHours(tile.minutes)}
                </span>
                <span className="text-[8px] uppercase tracking-wider text-muted-foreground">
                  {pct}%
                </span>
              </RadialProgress>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground group-hover:text-foreground">
                {tile.label}
              </p>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
