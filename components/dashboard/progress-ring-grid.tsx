"use client"

import * as React from "react"
import Link from "next/link"

import { RadialProgress } from "@/components/ui/radial-progress"
import {
  AUTO_FILL_DISPLAY,
  formatDecimalHours,
  type AutoFillMinutes,
} from "@/lib/utils/dashboard-aggregate"
import { usePreferences } from "@/components/providers/preferences-provider"
import { cn } from "@/lib/utils"

interface ProgressRingGridProps {
  byAutoFillField: AutoFillMinutes
  totalFlightMinutes: number
  className?: string
}

/** Rotating colour palette for rings — keeps tiles visually distinct. */
const RING_TONES: Array<{ track: string; indicator: string }> = [
  { track: "stroke-chart-2/15", indicator: "stroke-chart-2" },
  { track: "stroke-chart-3/15", indicator: "stroke-chart-3" },
  { track: "stroke-chart-4/15", indicator: "stroke-chart-4" },
  { track: "stroke-chart-5/15", indicator: "stroke-chart-5" },
  { track: "stroke-primary/15", indicator: "stroke-primary" },
]

export function ProgressRingGrid({
  byAutoFillField,
  totalFlightMinutes,
  className,
}: ProgressRingGridProps) {
  const { preferences } = usePreferences()
  const max = Math.max(totalFlightMinutes, 1)

  const tiles = React.useMemo(() => {
    return AUTO_FILL_DISPLAY.filter(({ key }) => preferences.autoFill[key]).map(
      ({ key, label }, idx) => ({
        key,
        label,
        minutes: byAutoFillField[key] ?? 0,
        tone: RING_TONES[idx % RING_TONES.length],
      }),
    )
  }, [preferences.autoFill, byAutoFillField])

  return (
    <div
      className={cn(
        "rounded-2xl border border-border/60 bg-card/70 p-2.5 sm:p-3 shadow-sm backdrop-blur-sm",
        className,
      )}
    >
      {tiles.length === 0 ? (
        <div className="flex h-full min-h-[72px] flex-col items-center justify-center gap-1 py-2 text-center">
          <p className="text-xs font-medium text-muted-foreground">
            No time fields enabled
          </p>
          <Link
            href="/settings"
            className="text-[11px] text-primary hover:underline"
          >
            Enable in Settings → Auto-fill time fields
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
          {tiles.map((tile) => {
            const pct = max > 0 ? Math.round((tile.minutes / max) * 100) : 0
            return (
              <Link
                key={tile.key}
                href="/logbook"
                className="group flex flex-col items-center gap-1 rounded-xl p-1 transition-colors hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`${tile.label} hours`}
              >
                <RadialProgress
                  value={tile.minutes}
                  max={max}
                  size={56}
                  strokeWidth={5}
                  trackClassName={tile.tone.track}
                  indicatorClassName={tile.tone.indicator}
                >
                  <span className="font-mono tabular-nums text-[10px] font-semibold text-foreground">
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
      )}
    </div>
  )
}
