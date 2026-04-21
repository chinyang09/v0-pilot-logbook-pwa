"use client"

import * as React from "react"
import Link from "next/link"
import { Sun, Moon } from "lucide-react"

import { formatDecimalHours } from "@/lib/utils/dashboard-aggregate"
import { cn } from "@/lib/utils"

interface DayNightSplitCardProps {
  dayMinutes: number
  nightMinutes: number
  className?: string
}

export function DayNightSplitCard({
  dayMinutes,
  nightMinutes,
  className,
}: DayNightSplitCardProps) {
  const total = dayMinutes + nightMinutes
  const dayPct = total > 0 ? (dayMinutes / total) * 100 : 50
  const nightPct = 100 - dayPct

  return (
    <div
      className={cn(
        "flex h-full flex-col rounded-2xl border border-border/60 bg-card/70 p-3 sm:p-4 shadow-sm backdrop-blur-sm",
        className,
      )}
    >
      <div className="grid grid-cols-2 divide-x divide-border/50">
        <Link
          href="/logbook"
          className="flex items-center gap-2 pr-3 hover:opacity-90 transition-opacity"
          aria-label="Day flight hours"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-chart-4/10 text-chart-4">
            <Sun className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Day
            </p>
            <p className="font-mono tabular-nums text-lg sm:text-xl font-bold text-foreground">
              {formatDecimalHours(dayMinutes)}
            </p>
          </div>
        </Link>
        <Link
          href="/logbook"
          className="flex items-center gap-2 pl-3 hover:opacity-90 transition-opacity"
          aria-label="Night flight hours"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-chart-3/10 text-chart-3">
            <Moon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Night
            </p>
            <p className="font-mono tabular-nums text-lg sm:text-xl font-bold text-foreground">
              {formatDecimalHours(nightMinutes)}
            </p>
          </div>
        </Link>
      </div>
      <div className="mt-3 flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-chart-4/80 transition-[width] duration-500 motion-reduce:transition-none"
          style={{ width: `${dayPct}%` }}
        />
        <div
          className="h-full bg-chart-3/80 transition-[width] duration-500 motion-reduce:transition-none"
          style={{ width: `${nightPct}%` }}
        />
      </div>
    </div>
  )
}
