"use client"

import * as React from "react"

import { useDashboardPeriod } from "@/hooks/use-dashboard-period"
import { useDashboardAggregates } from "@/hooks/data/use-dashboard-aggregates"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

import { PeriodSummary } from "./period-summary"
import { PeriodFlights } from "./period-flights"
import { BreakdownPanel } from "./breakdown-panel"

/**
 * The dashboard's second page: what has been flown, and how it adds up.
 *
 * Everything here is period-scoped and scrollable, which is precisely why it is
 * not on the legal page. A pilot reviewing a month wants depth and is happy to
 * scroll for it; a pilot about to report for duty wants one screen and no
 * scrolling at all. Serving both from one layout is what turns a dashboard into
 * a spreadsheet.
 *
 * Three blocks, one column, in the order the questions get asked:
 *
 * 1. `PeriodSummary` — what the period came to
 * 2. `PeriodFlights` — which flights those were, each row opening in place
 * 3. `BreakdownPanel` — how the hours split by role and by fleet
 *
 * ONE COLUMN AT EVERY WIDTH. A wider container buys DENSITY INSIDE each block
 * (a flight's detail goes from four fields per row to eight, the breakdown from
 * stacked to side by side), never a rearrangement — and every step is a
 * container query, because this page renders inside a resizable split panel
 * where the viewport's width says nothing about the room a block has.
 */
export function SummaryDashboard({ className }: { className?: string }) {
  const { resolved } = useDashboardPeriod()
  const { aggregates, isLoading } = useDashboardAggregates({
    fromIso: resolved.fromIso,
    toIso: resolved.toIso,
  })

  if (isLoading) {
    return (
      <div className={cn("flex flex-col gap-3", className)}>
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
        <Skeleton className="h-32 rounded-2xl" />
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <PeriodSummary
        blockMinutes={aggregates.totals.blockMinutes}
        simMinutes={aggregates.totals.simMinutes}
        flightCount={aggregates.totals.flightCount}
        dayMinutes={aggregates.dayMinutes}
        nightMinutes={aggregates.nightMinutes}
      />

      <PeriodFlights flights={aggregates.periodFlights} />

      {/* Denominator is BLOCK time, the same clock as the hero figure above:
          against flight time the role percentages were nonsense (SIC 33.7h and
          P1US 16.9h are a complete split of a 50.6h block total, and rendered
          as 81% + 40% = 121%). */}
      <BreakdownPanel
        byAutoFillField={aggregates.byAutoFillField}
        totalBlockMinutes={aggregates.totals.blockMinutes}
        byEngine={aggregates.byEngine}
        topTypes={aggregates.topTypes}
      />
    </div>
  )
}
