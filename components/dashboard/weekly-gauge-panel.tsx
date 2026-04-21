"use client"

import * as React from "react"

import { MiniBar } from "@/components/ui/mini-bar"
import { formatDecimalHours } from "@/lib/utils/dashboard-aggregate"
import { cn } from "@/lib/utils"

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"] as const

interface WeeklyGaugePanelProps {
  title: string
  values: number[] // length 7, Mon→Sun, in minutes
  indicatorClassName?: string
  className?: string
}

export function WeeklyGaugePanel({
  title,
  values,
  indicatorClassName,
  className,
}: WeeklyGaugePanelProps) {
  const max = Math.max(...values, 1)
  const todayIndex = ((new Date().getDay() + 6) % 7)

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col rounded-2xl border border-border/60 bg-card/70 p-3 sm:p-4 shadow-sm backdrop-blur-sm",
        className,
      )}
    >
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <ul className="flex flex-1 flex-col gap-1.5">
        {values.map((minutes, i) => {
          const isToday = i === todayIndex
          return (
            <li key={i} className="flex items-center gap-2">
              <span
                className={cn(
                  "w-3 text-[10px] font-semibold",
                  isToday ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {DAY_LABELS[i]}
              </span>
              <MiniBar
                value={minutes}
                max={max}
                indicatorClassName={cn(
                  isToday ? "bg-primary" : "bg-chart-2/60",
                  indicatorClassName,
                )}
                className="flex-1"
                height={6}
              />
              <span className="w-9 text-right font-mono tabular-nums text-[11px] text-foreground/80">
                {formatDecimalHours(minutes)}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
