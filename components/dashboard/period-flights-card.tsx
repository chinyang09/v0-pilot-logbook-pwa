"use client"

import * as React from "react"
import Link from "next/link"
import { Plane } from "lucide-react"

import {
  formatDecimalHours,
  type PeriodFlight,
} from "@/lib/utils/dashboard-aggregate"
import { cn } from "@/lib/utils"

interface PeriodFlightsCardProps {
  flights: PeriodFlight[]
  className?: string
}

function formatDate(iso: string): string {
  if (!iso) return ""
  const d = new Date(`${iso}T00:00:00`)
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
  }).format(d)
}

function formatRoute(f: PeriodFlight): string {
  const dep = f.departureIcao || f.departureIata || "—"
  const arr = f.arrivalIcao || f.arrivalIata || "—"
  return `${dep}-${arr}`
}

export function PeriodFlightsCard({ flights, className }: PeriodFlightsCardProps) {
  return (
    <div
      className={cn(
        "flex h-full w-full flex-col rounded-2xl border border-border/60 bg-card/70 p-2.5 sm:p-3 shadow-sm backdrop-blur-sm",
        className,
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Plane className="h-3 w-3" />
          Flights in period
        </p>
        <span className=" tabular-nums text-[11px] text-foreground/70">
          {flights.length}
        </span>
      </div>

      {flights.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          No flights in this period
        </div>
      ) : (
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto overflow-x-hidden">
          {flights.map((f) => (
            <li key={f.id}>
              <Link
                href={`/flights/${f.id}`}
                className="flex items-center gap-1.5 rounded-lg px-1 py-1 text-xs transition-colors hover:bg-accent/40"
              >
                <span className="w-11 shrink-0 tabular-nums text-muted-foreground">
                  {formatDate(f.date)}
                </span>
                <span className="w-12 shrink-0 truncate font-medium text-foreground">
                  {f.flightNumber || "—"}
                </span>
                {/* min-w-0 lets the route shrink + truncate instead of pushing
                    the row wider than the card (which caused horizontal scroll). */}
                <span className="min-w-0 flex-1 truncate tabular-nums text-foreground/80">
                  {formatRoute(f)}
                </span>
                <span className="shrink-0 tabular-nums text-foreground">
                  {formatDecimalHours(f.blockMinutes)}h
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
