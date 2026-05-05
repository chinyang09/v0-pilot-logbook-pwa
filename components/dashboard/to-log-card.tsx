"use client"

import * as React from "react"
import Link from "next/link"
import { PlaneTakeoff, PlaneLanding, ShieldCheck, ShieldAlert } from "lucide-react"

import { RadialProgress } from "@/components/ui/radial-progress"
import type { NinetyDayCurrency, TLEvent } from "@/lib/utils/dashboard-aggregate"
import { cn } from "@/lib/utils"

interface ToLogCardProps {
  takeoffs: number
  landings: number
  recentEvents: TLEvent[]
  currency: NinetyDayCurrency
  className?: string
}

function formatShortDate(iso: string): string {
  if (!iso) return ""
  const d = new Date(`${iso}T00:00:00`)
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(d)
}

export function ToLogCard({
  takeoffs,
  landings,
  recentEvents,
  currency,
  className,
}: ToLogCardProps) {
  const max = Math.max(takeoffs, landings, 1)
  const isCurrent = currency.current

  return (
    <Link
      href="/logbook"
      aria-label="Takeoffs and landings"
      className={cn(
        "flex h-full flex-col rounded-2xl border border-border/60 bg-card/70 p-2.5 sm:p-3 shadow-sm backdrop-blur-sm transition-colors hover:border-primary/40",
        className,
      )}
    >
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col items-center gap-1">
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
          <p className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <PlaneTakeoff className="h-3 w-3" />
            T/O
          </p>
        </div>
        <div className="flex flex-col items-center gap-1">
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
          <p className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <PlaneLanding className="h-3 w-3" />
            LDG
          </p>
        </div>
      </div>

      <div
        className={cn(
          "mt-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1 text-[10px]",
          isCurrent
            ? "border-chart-2/30 bg-chart-2/10 text-chart-2"
            : "border-destructive/30 bg-destructive/10 text-destructive",
        )}
      >
        <span className="inline-flex items-center gap-1 font-semibold uppercase tracking-wider">
          {isCurrent ? (
            <ShieldCheck className="h-3 w-3" />
          ) : (
            <ShieldAlert className="h-3 w-3" />
          )}
          {isCurrent ? "Current" : "Not current"}
        </span>
        <span className="font-mono tabular-nums text-foreground/80">
          {currency.takeoffs}/{currency.landings} · 90d
        </span>
      </div>

      {recentEvents.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {recentEvents.map((ev) => (
            <li
              key={ev.flightId}
              className="flex items-center justify-between gap-2 text-[11px]"
            >
              <span className="truncate text-muted-foreground">
                {formatShortDate(ev.date)}
                {" · "}
                <span className="font-medium text-foreground">
                  {ev.flightNumber || ev.aircraftReg || "—"}
                </span>
              </span>
              <span className="shrink-0 font-mono tabular-nums text-foreground/80">
                {ev.takeoffs}/{ev.landings}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          No takeoffs or landings logged yet
        </p>
      )}
    </Link>
  )
}
