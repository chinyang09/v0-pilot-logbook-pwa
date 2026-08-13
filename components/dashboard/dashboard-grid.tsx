"use client"

import * as React from "react"

import { useDashboardPeriod } from "@/hooks/use-dashboard-period"
import { useDashboardAggregates } from "@/hooks/data/use-dashboard-aggregates"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

import { HeroTotalsWidget } from "./hero-totals-widget"
import { PeriodFlightsCard } from "./period-flights-card"
import { ProgressRingGrid } from "./progress-ring-grid"
import { EngineClassCard } from "./engine-class-card"
import { ToLogCard } from "./to-log-card"
import { FDPLimitsStack } from "./fdp-limits-stack"

// One layout for all viewport sizes — mirrors the desktop main panel
// (6-col grid). Cards span half (3) or full (6) columns regardless of
// breakpoint.
export function DashboardGrid({ className }: { className?: string }) {
  const { resolved } = useDashboardPeriod()
  const { aggregates, isLoading } = useDashboardAggregates({
    fromIso: resolved.fromIso,
    toIso: resolved.toIso,
  })

  if (isLoading) {
    return <DashboardGridSkeleton className={className} />
  }

  return (
    <div className={cn("grid grid-cols-6 gap-3", className)}>
      {/* Hero showpiece — ring + Flights / Sim / Day / Night.
          "Flight" hours = block time (chocks-off to chocks-on). */}
      <div className="col-span-3 row-span-2">
        <HeroTotalsWidget
          blockMinutes={aggregates.totals.blockMinutes}
          simMinutes={aggregates.totals.simMinutes}
          flightCount={aggregates.totals.flightCount}
          dayMinutes={aggregates.dayMinutes}
          nightMinutes={aggregates.nightMinutes}
          className="h-full"
        />
      </div>

      {/* Per-flight breakdown — same height as the hero, scrollable list. The
          card is taken out of flow (absolute) so its (potentially long) list
          doesn't stretch the shared grid rows; the hero defines the height and
          the list scrolls inside. */}
      <div className="col-span-3 row-span-2 relative">
        <PeriodFlightsCard
          flights={aggregates.periodFlights}
          className="absolute inset-0"
        />
      </div>

      {/* Progress rings — auto-fill-driven */}
      <div className="col-span-6">
        {/* Denominator is BLOCK time, the same clock as the hero ring above.
            Against flight time the role percentages were nonsense: SIC 33.7h
            and P1US 16.9h are a complete split of a 50.6h block total, and
            they rendered as 81% + 40% = 121%. */}
        <ProgressRingGrid
          byAutoFillField={aggregates.byAutoFillField}
          totalFlightMinutes={aggregates.totals.blockMinutes}
          className="h-full"
        />
      </div>

      {/* Take-offs / Landings — last 3 events + 90-day currency status */}
      <div className="col-span-3">
        <ToLogCard
          takeoffs={aggregates.takeoffs}
          landings={aggregates.landings}
          recentEvents={aggregates.recentTLEvents}
          currency={aggregates.ninetyDayCurrency}
          className="h-full"
        />
      </div>

      {/* Engine class breakdown */}
      <div className="col-span-3">
        <EngineClassCard
          byEngine={aggregates.byEngine}
          topTypes={aggregates.topTypes}
          className="h-full"
        />
      </div>

      {/* FDP cumulative limits stack */}
      <div className="col-span-6">
        <FDPLimitsStack className="h-full" />
      </div>
    </div>
  )
}

function DashboardGridSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("grid grid-cols-6 gap-3", className)}>
      <Skeleton className="h-72 rounded-2xl col-span-3 row-span-2" />
      <Skeleton className="h-72 rounded-2xl col-span-3 row-span-2" />
      <Skeleton className="h-28 rounded-2xl col-span-6" />
      <Skeleton className="h-32 rounded-2xl col-span-3" />
      <Skeleton className="h-32 rounded-2xl col-span-3" />
      <Skeleton className="h-44 rounded-2xl col-span-6" />
    </div>
  )
}
