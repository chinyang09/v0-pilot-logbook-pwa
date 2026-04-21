"use client"

import * as React from "react"

import { useDashboardPeriod } from "@/hooks/use-dashboard-period"
import { useDashboardAggregates } from "@/hooks/data/use-dashboard-aggregates"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

import { HeroTotalsWidget } from "./hero-totals-widget"
import { WeeklyGaugePanel } from "./weekly-gauge-panel"
import { ClassTotalsRow } from "./class-totals-row"
import { DayNightSplitCard } from "./day-night-split-card"
import { ProgressRingGrid } from "./progress-ring-grid"
import { EngineClassCard } from "./engine-class-card"
import { ToLogCard } from "./to-log-card"
import { FDPLimitsStack } from "./fdp-limits-stack"
import { FlightDutyCard, DutyPeriodCard } from "./duty-corner-cards"

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
        // Mobile: single column. md: 6-col split. xl: 12-col wide layout.
        "grid grid-cols-1 gap-3 md:grid-cols-6 md:gap-4 xl:grid-cols-12",
        className,
      )}
    >
      {/* Hero — central, dominant on every breakpoint */}
      <div className="md:col-span-4 md:row-span-2 xl:col-span-6 xl:row-span-2">
        <HeroTotalsWidget
          flightMinutes={aggregates.totals.flightMinutes}
          simMinutes={aggregates.totals.simMinutes}
          blockMinutes={aggregates.totals.blockMinutes}
          flightCount={aggregates.totals.flightCount}
          className="h-full"
        />
      </div>

      {/* Weekly gauges — flanks hero on desktop */}
      <div className="md:col-span-2 md:row-span-2 xl:col-span-3 xl:row-span-2">
        <WeeklyGaugePanel
          title="This Week — Flight"
          values={aggregates.weekdayFlightMinutes}
          className="h-full"
        />
      </div>

      {/* Corner cards — Flight Duty + Duty Period (FDP regulatory windows) */}
      <div className="grid grid-cols-2 gap-3 md:col-span-3 xl:col-span-3 xl:grid-cols-1 xl:gap-3">
        <FlightDutyCard className="h-full" />
        <DutyPeriodCard className="h-full" />
      </div>

      {/* Class totals row */}
      <div className="md:col-span-6 xl:col-span-9">
        <ClassTotalsRow
          byCategory={aggregates.byCategory}
          dualMinutes={aggregates.dualMinutes}
        />
      </div>

      {/* Day / Night split */}
      <div className="md:col-span-3 xl:col-span-4">
        <DayNightSplitCard
          dayMinutes={aggregates.dayMinutes}
          nightMinutes={aggregates.nightMinutes}
          className="h-full"
        />
      </div>

      {/* Progress rings — XC / Actual / Sim / Dual */}
      <div className="md:col-span-3 xl:col-span-5">
        <ProgressRingGrid
          xcMinutes={aggregates.xcMinutes}
          actualIRMinutes={aggregates.actualIRMinutes}
          simIRMinutes={aggregates.simIRMinutes}
          dualMinutes={aggregates.dualMinutes}
          totalFlightMinutes={aggregates.totals.flightMinutes}
          className="h-full"
        />
      </div>

      {/* Take-offs / Landings */}
      <div className="md:col-span-3 xl:col-span-3">
        <ToLogCard
          takeoffs={aggregates.takeoffs}
          landings={aggregates.landings}
          className="h-full"
        />
      </div>

      {/* Engine class breakdown */}
      <div className="md:col-span-3 xl:col-span-5">
        <EngineClassCard
          byEngine={aggregates.byEngine}
          topTypes={aggregates.topTypes}
          className="h-full"
        />
      </div>

      {/* FDP cumulative limits stack */}
      <div className="md:col-span-6 xl:col-span-7">
        <FDPLimitsStack className="h-full" />
      </div>
    </div>
  )
}

function DashboardGridSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-3 md:grid-cols-6 md:gap-4 xl:grid-cols-12",
        className,
      )}
    >
      <Skeleton className="h-72 rounded-2xl md:col-span-4 md:row-span-2 xl:col-span-6" />
      <Skeleton className="h-72 rounded-2xl md:col-span-2 md:row-span-2 xl:col-span-3" />
      <div className="grid grid-cols-2 gap-3 md:col-span-3 xl:col-span-3 xl:grid-cols-1">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
      </div>
      <Skeleton className="h-20 rounded-2xl md:col-span-6 xl:col-span-9" />
      <Skeleton className="h-32 rounded-2xl md:col-span-3 xl:col-span-4" />
      <Skeleton className="h-32 rounded-2xl md:col-span-3 xl:col-span-5" />
      <Skeleton className="h-32 rounded-2xl md:col-span-3 xl:col-span-3" />
      <Skeleton className="h-44 rounded-2xl md:col-span-3 xl:col-span-5" />
      <Skeleton className="h-44 rounded-2xl md:col-span-6 xl:col-span-7" />
    </div>
  )
}
