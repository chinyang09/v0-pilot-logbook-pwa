"use client"

import * as React from "react"

import { useDashboardPeriod } from "@/hooks/use-dashboard-period"
import { useDashboardAggregates } from "@/hooks/data/use-dashboard-aggregates"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

import { LegalityPanel } from "./legality-panel"
import { PeriodSummary } from "./period-summary"
import { PeriodFlights } from "./period-flights"
import { BreakdownPanel } from "./breakdown-panel"

/**
 * The dashboard, in the order the questions get asked.
 *
 * 1. **Can I fly?** — every requirement that constitutes being legal, each with
 *    its own state. First because it is the only block that can stop the day.
 * 2. **What has the period come to?** — the hero figure and its split.
 * 3. **Which flights were they?** — the list behind that number, each row
 *    opening in place.
 * 4. **How does it break down?** — role and fleet. Last because it is the only
 *    part nobody needs before a flight.
 *
 * ONE COLUMN AT EVERY WIDTH, and that is the whole layout decision.
 *
 * The blocks are stacked in that order on a 390px phone and in the same order
 * on a 1400px desktop; nothing moves, nothing is reordered, nothing appears in
 * one and not the other. What a wider screen buys is DENSITY INSIDE each block
 * — the legality grid goes from two columns to six, a flight's detail from four
 * fields per row to eight, the breakdown from stacked to side-by-side — so
 * desktop genuinely carries more information without becoming a second layout
 * the reader has to learn.
 *
 * Every one of those steps is a **container query**, not a viewport breakpoint.
 * This page renders inside a resizable split panel, so the window's width says
 * nothing about the room a block actually has; a panel dragged to 360px is a
 * phone, and it should lay out like one.
 *
 * The previous version was a 6-column grid of six cards, which on a phone was
 * several screens of scrolling before the first flight and put the legality
 * pieces — rest, recency, limits, expiries — in four different places, none of
 * them first.
 */
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
    <div className={cn("flex flex-col gap-3", className)}>
      {/* 1 — Can I fly? Recency is passed down rather than recomputed: it comes
             off this same aggregate, and the alternative is a second full walk
             of the flight history on a keep-alive page. */}
      <LegalityPanel recency={aggregates.ninetyDayCurrency} />

      {/* 2 — What the period came to. */}
      <PeriodSummary
        blockMinutes={aggregates.totals.blockMinutes}
        simMinutes={aggregates.totals.simMinutes}
        flightCount={aggregates.totals.flightCount}
        dayMinutes={aggregates.dayMinutes}
        nightMinutes={aggregates.nightMinutes}
      />

      {/* 3 — The flights behind it. */}
      <PeriodFlights flights={aggregates.periodFlights} />

      {/* 4 — How it splits. Denominator is BLOCK time, the same clock as the
             hero figure above: against flight time the role percentages were
             nonsense (SIC 33.7h and P1US 16.9h are a complete split of a 50.6h
             block total, and rendered as 81% + 40% = 121%). */}
      <BreakdownPanel
        byAutoFillField={aggregates.byAutoFillField}
        totalBlockMinutes={aggregates.totals.blockMinutes}
        byEngine={aggregates.byEngine}
        topTypes={aggregates.topTypes}
      />
    </div>
  )
}

function DashboardGridSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <Skeleton className="h-64 rounded-2xl" />
      <Skeleton className="h-28 rounded-2xl" />
      <Skeleton className="h-48 rounded-2xl" />
      <Skeleton className="h-32 rounded-2xl" />
    </div>
  )
}
