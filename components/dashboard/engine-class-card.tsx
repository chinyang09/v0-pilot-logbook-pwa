"use client"

import * as React from "react"
import Link from "next/link"

import { MiniBar } from "@/components/ui/mini-bar"
import type { DashboardAggregates } from "@/lib/utils/dashboard-aggregate"
import { formatDecimalHours } from "@/lib/utils/dashboard-aggregate"
import { cn } from "@/lib/utils"

interface EngineClassCardProps {
  byEngine: DashboardAggregates["byEngine"]
  topTypes: DashboardAggregates["topTypes"]
  className?: string
}

export function EngineClassCard({ byEngine, topTypes, className }: EngineClassCardProps) {
  const totalEngine = byEngine.se + byEngine.me + byEngine.jet
  const maxType = Math.max(...topTypes.map((t) => t.minutes), 1)

  return (
    <Link
      href="/aircraft"
      aria-label="Engine class breakdown"
      className={cn(
        "group flex h-full flex-col rounded-2xl border border-border/60 bg-card/70 p-2.5 sm:p-3 shadow-sm backdrop-blur-sm transition-colors hover:border-primary/40",
        className,
      )}
    >
      <div className="grid grid-cols-3 gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            SE
          </p>
          <p className=" tabular-nums text-lg font-bold text-foreground">
            {formatDecimalHours(byEngine.se)}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            ME
          </p>
          <p className=" tabular-nums text-lg font-bold text-foreground">
            {formatDecimalHours(byEngine.me)}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Jet
          </p>
          <p className=" tabular-nums text-lg font-bold text-foreground">
            {formatDecimalHours(byEngine.jet)}
          </p>
        </div>
      </div>
      <div className="mt-3 flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
        {totalEngine > 0 && (
          <>
            <div
              className="h-full bg-chart-2/80"
              style={{ width: `${(byEngine.se / totalEngine) * 100}%` }}
            />
            <div
              className="h-full bg-chart-4/80"
              style={{ width: `${(byEngine.me / totalEngine) * 100}%` }}
            />
            <div
              className="h-full bg-chart-3/80"
              style={{ width: `${(byEngine.jet / totalEngine) * 100}%` }}
            />
          </>
        )}
      </div>

      {topTypes.length > 0 && (
        <div className="mt-4 space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Top types
          </p>
          {topTypes.map((t) => (
            <div key={t.type} className="flex items-center gap-2">
              <span className="w-12 truncate text-xs font-medium text-foreground">{t.type}</span>
              <MiniBar
                value={t.minutes}
                max={maxType}
                indicatorClassName="bg-primary"
                className="flex-1"
                height={4}
              />
              <span className="w-10 text-right tabular-nums text-[11px] text-foreground/80">
                {formatDecimalHours(t.minutes)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Link>
  )
}
