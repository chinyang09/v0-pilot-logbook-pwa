"use client"

import * as React from "react"
import Link from "next/link"
import { PlaneTakeoff, PlaneLanding } from "lucide-react"

import { RadialProgress } from "@/components/ui/radial-progress"
import { cn } from "@/lib/utils"

interface ToLogCardProps {
  takeoffs: number
  landings: number
  className?: string
}

export function ToLogCard({ takeoffs, landings, className }: ToLogCardProps) {
  const max = Math.max(takeoffs, landings, 1)

  return (
    <Link
      href="/logbook"
      aria-label="Takeoffs and landings"
      className={cn(
        "flex h-full items-center gap-3 rounded-2xl border border-border/60 bg-card/70 p-3 sm:p-4 shadow-sm backdrop-blur-sm transition-colors hover:border-primary/40",
        className,
      )}
    >
      <div className="flex flex-1 items-center gap-2">
        <RadialProgress
          value={takeoffs}
          max={max}
          size={56}
          strokeWidth={5}
          trackClassName="stroke-chart-2/15"
          indicatorClassName="stroke-chart-2"
        >
          <span className="font-mono tabular-nums text-sm font-bold text-foreground">
            {takeoffs}
          </span>
        </RadialProgress>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <PlaneTakeoff className="inline h-3 w-3 mr-1" />
            T/O
          </p>
        </div>
      </div>
      <div className="flex flex-1 items-center gap-2">
        <RadialProgress
          value={landings}
          max={max}
          size={56}
          strokeWidth={5}
          trackClassName="stroke-chart-3/15"
          indicatorClassName="stroke-chart-3"
        >
          <span className="font-mono tabular-nums text-sm font-bold text-foreground">
            {landings}
          </span>
        </RadialProgress>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <PlaneLanding className="inline h-3 w-3 mr-1" />
            LDG
          </p>
        </div>
      </div>
    </Link>
  )
}
