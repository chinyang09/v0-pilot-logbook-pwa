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
    <div
      className={cn(
        "grid grid-cols-1 gap-2 md:grid-cols-6 md:gap-3 xl:grid-cols-12",
        className,
      )}
    >
      {/* Hero showpiece — ring + Flights / Sim / Day / Night.
          "Flight" hours = block time (chocks-off to chocks-on). */}
      <div className="md:col-span-3 xl:col-span-6 xl:row-span-2">
        <HeroTotalsWidget
          blockMinutes={aggregates.totals.blockMinutes}
          simMinutes={aggregates.totals.simMinutes}
          flightCount={aggregates.totals.flightCount}
          dayMinutes={aggregates.dayMinutes}
          nightMinutes={aggregates.nightMinutes}
          className="h-full"
        />
      </div>

      {/* Per-flight breakdown for the active period */}
      <div className="md:col-span-3 xl:col-span-6">
        <PeriodFlightsCard
          flights={aggregates.periodFlights}
          className="h-full"
        />
      </div>

      {/* Progress rings — auto-fill-driven */}
      <div className="md:col-span-6 xl:col-span-6">
        <ProgressRingGrid
          byAutoFillField={aggregates.byAutoFillField}
          totalFlightMinutes={aggregates.totals.flightMinutes}
          className="h-full"
        />
      </div>

      {/* Take-offs / Landings — last 3 events + 90-day currency status */}
      <div className="md:col-span-3 xl:col-span-4">
        <ToLogCard
          takeoffs={aggregates.takeoffs}
          landings={aggregates.landings}
          recentEvents={aggregates.recentTLEvents}
          currency={aggregates.ninetyDayCurrency}
          className="h-full"
        />
      </div>

      {/* Engine class breakdown */}
      <div className="md:col-span-3 xl:col-span-8">
        <EngineClassCard
          byEngine={aggregates.byEngine}
          topTypes={aggregates.topTypes}
          className="h-full"
        />
      </div>

      {/* FDP cumulative limits stack */}
      <div className="md:col-span-6 xl:col-span-12">
        <FDPLimitsStack className="h-full" />
      </div>
    </div>
  )
}

function DashboardGridSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-2 md:grid-cols-6 md:gap-3 xl:grid-cols-12",
        className,
      )}
    >
      <Skeleton className="h-72 rounded-2xl md:col-span-3 xl:col-span-6 xl:row-span-2" />
      <Skeleton className="h-40 rounded-2xl md:col-span-3 xl:col-span-6" />
      <Skeleton className="h-28 rounded-2xl md:col-span-6 xl:col-span-6" />
      <Skeleton className="h-32 rounded-2xl md:col-span-3 xl:col-span-4" />
      <Skeleton className="h-32 rounded-2xl md:col-span-3 xl:col-span-8" />
      <Skeleton className="h-44 rounded-2xl md:col-span-6 xl:col-span-12" />
    </div>
  )
}
