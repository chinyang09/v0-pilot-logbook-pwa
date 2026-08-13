"use client"

import * as React from "react"
import Link from "next/link"
import { Check, TriangleAlert, OctagonAlert, Minus } from "lucide-react"

import type { Requirement, RequirementState } from "@/lib/utils/dashboard/legality"
import { cn } from "@/lib/utils"

/**
 * ONE row shape for every requirement, whatever it is made of — rest minutes, a
 * landing count, a rolling hour limit, a document's expiry.
 *
 * That sameness is the point. A pilot scanning the panel is asking one question
 * of every row ("is this one met, and how close is it?"), so every row answers
 * it in the same two places: the icon says the state and the meter says how
 * full. Giving each kind of requirement its own presentation would mean reading
 * four different widgets to answer one question.
 *
 * State is NEVER carried by colour alone — each state has its own icon and the
 * value is written out. Red/amber on a small meter is exactly the case a
 * colour-blind reader loses, and this panel is the one nobody can afford to
 * misread.
 */

const STATE_ICON: Record<RequirementState, React.ComponentType<{ className?: string }>> = {
  ok: Check,
  caution: TriangleAlert,
  fail: OctagonAlert,
  unknown: Minus,
}

/**
 * The status ramp. Reserved for state — never reused as a series colour.
 *
 * `fill` is the meter's severity; `track` is a lighter step of the SAME hue, so
 * the state reads across the whole bar rather than only the filled part.
 */
const STATE_TONE: Record<
  RequirementState,
  { icon: string; fill: string; track: string }
> = {
  ok: {
    icon: "text-chart-2",
    fill: "bg-chart-2",
    track: "bg-chart-2/15",
  },
  caution: {
    icon: "text-chart-4",
    fill: "bg-chart-4",
    track: "bg-chart-4/15",
  },
  fail: {
    icon: "text-destructive",
    fill: "bg-destructive",
    track: "bg-destructive/15",
  },
  unknown: {
    icon: "text-muted-foreground",
    fill: "bg-muted-foreground",
    track: "bg-muted",
  },
}

export function RequirementRow({
  requirement,
  /** Replaces the static value — the rest row ticks a live countdown. */
  valueOverride,
  className,
}: {
  requirement: Requirement
  valueOverride?: string
  className?: string
}) {
  const { label, state, value, progress, href } = requirement
  const tone = STATE_TONE[state]
  const Icon = STATE_ICON[state]

  return (
    <Link
      href={href}
      className={cn(
        "group flex min-w-0 flex-col gap-1 rounded-lg px-2 py-1.5 transition-colors",
        "hover:bg-[var(--on-glass-fill-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <div className="flex min-w-0 items-baseline gap-1.5">
        <Icon className={cn("h-3 w-3 shrink-0 self-center", tone.icon)} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-muted-foreground">
          {label}
        </span>
        {/* tabular-nums: these align down the grid's columns. Text stays on a
            text token — the meter below carries the colour. */}
        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-foreground">
          {valueOverride ?? value}
        </span>
      </div>

      {/* A hairline meter, not a bar chart: it is read as "how full", and the
          precise number is already spelled out above it. */}
      <div className={cn("h-[3px] w-full overflow-hidden rounded-full", tone.track)}>
        {progress !== undefined && (
          <div
            className={cn("h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none", tone.fill)}
            style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
          />
        )}
      </div>

      <span className="sr-only">
        {label}: {valueOverride ?? value}, {STATE_WORD[state]}
      </span>
    </Link>
  )
}

const STATE_WORD: Record<RequirementState, string> = {
  ok: "met",
  caution: "close to limit",
  fail: "not met",
  unknown: "unknown",
}
