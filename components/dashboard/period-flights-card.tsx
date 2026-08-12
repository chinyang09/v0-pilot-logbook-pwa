"use client"

import { formatYMDShort as formatDate } from "@/lib/utils/date"
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

function formatRoute(f: PeriodFlight): string {
  const dep = f.departureIcao || f.departureIata || "—"
  const arr = f.arrivalIcao || f.arrivalIata || "—"
  return `${dep}-${arr}`
}

/**
 * Cap on rendered rows. Long periods ("1y"/"All") can hold hundreds of flights;
 * mounting them all costs real time on every dashboard visit for rows nobody
 * scrolls through here — the logbook is the place for the full list.
 */
const MAX_ROWS = 50

export function PeriodFlightsCard({ flights, className }: PeriodFlightsCardProps) {
  return (
    <div
      className={cn(
        // @container: row columns adapt to the CARD's width (it lives in a
        // resizable split panel, so viewport breakpoints are meaningless here).
        "@container flex h-full w-full flex-col rounded-2xl border border-border/60 bg-card/70 p-2.5 sm:p-3 shadow-sm",
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
        // pr-1.5: a lane for the overlay scrollbar (iPadOS draws it ON TOP of
        // content, which visually chopped the trailing duration digits).
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto overflow-x-hidden pr-1.5">
          {flights.slice(0, MAX_ROWS).map((f) => (
            <li key={f.id}>
              <Link
                href={`/flights/${f.id}`}
                className="flex items-center gap-1.5 rounded-lg px-1 py-1 text-xs transition-colors hover:bg-accent/40"
              >
                <span className="w-10 shrink-0 tabular-nums text-muted-foreground">
                  {formatDate(f.date)}
                </span>
                <span className="w-12 shrink-0 truncate font-medium text-foreground">
                  {f.flightNumber || "—"}
                </span>
                {/* Route is the first column to go: hidden below 15rem card
                    width, where it could only render as an empty truncation
                    while its fixed siblings overflowed the card (clipped
                    durations at the 360px panel snap). min-w-0 lets it shrink
                    + truncate when shown. */}
                <span className="hidden min-w-0 flex-1 truncate tabular-nums text-foreground/80 @[15rem]:block">
                  {formatRoute(f)}
                </span>
                <span className="ml-auto shrink-0 tabular-nums text-foreground">
                  {formatDecimalHours(f.blockMinutes)}h
                </span>
              </Link>
            </li>
          ))}
          {flights.length > MAX_ROWS && (
            <li>
              <Link
                href="/logbook"
                className="flex items-center justify-center rounded-lg px-1.5 py-1.5 text-xs text-primary transition-colors hover:bg-accent/40"
              >
                View all {flights.length} flights in logbook
              </Link>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
