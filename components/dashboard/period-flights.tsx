"use client"

import * as React from "react"
import Link from "next/link"
import { ChevronRight, ArrowUpRight } from "lucide-react"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import { useIsDesktop } from "@/hooks/use-is-desktop"

import { usePreferences } from "@/components/providers/preferences-provider"
import { formatDecimalHours, type PeriodFlight } from "@/lib/utils/dashboard-aggregate"
import { getAirportDisplayCode } from "@/lib/utils/airport-display"
import { formatYMDShort } from "@/lib/utils/date"
import { cn } from "@/lib/utils"

/**
 * The flights that make up the period's numbers.
 *
 * A row opens the FLIGHT in the detail panel — beside the dashboard on a
 * tablet, the overlay on a phone — the way a flight opens anywhere else (the
 * owner's main / detail rule). The period stays where it was underneath, which
 * is what the old in-place unfold was protecting; the panel shows the whole
 * record rather than the eight fields the unfold had room for.
 */

/**
 * Rows rendered before the list defers to the logbook.
 *
 * A year or an all-time period holds hundreds of flights, and mounting them all
 * costs real time on every dashboard visit for rows nobody scrolls to here.
 * The list SCROLLS inside its own box rather than growing the page, so a long
 * period cannot push the breakdown below it out of reach — and so the block
 * keeps a predictable size whatever period is selected.
 */
const MAX_ROWS = 60

/** The list's own scroll box. About eight rows — enough to read a working week
 *  without the block taking over the page. */
const LIST_MAX_HEIGHT = 320

export function PeriodFlights({
  flights,
  className,
}: {
  flights: PeriodFlight[]
  className?: string
}) {
  const { preferences } = usePreferences()
  const { selectedId, setSelectedId } = useDetailPanel()
  const isDesktop = useIsDesktop()

  const shown = flights.slice(0, MAX_ROWS)

  return (
    <section
      className={cn(
        "@container flex min-h-0 flex-col rounded-3xl border border-border/60 bg-card/70 p-4 shadow-sm",
        className,
      )}
      aria-label="Flights in period"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Flights</p>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {flights.length}
        </span>
      </div>

      {flights.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          No flights in this period
        </p>
      ) : (
        <ul
          className="mt-1 overflow-y-auto overscroll-contain scrollbar-hide"
          style={{ maxHeight: LIST_MAX_HEIGHT }}
        >
          {shown.map((f) => (
            <FlightRow
              key={f.id}
              flight={f}
              // Lit only where the panel BESIDE the list shows it.
              selected={isDesktop && selectedId === f.id}
              onOpen={setSelectedId}
              airportPref={preferences.display.airportIdentifier}
            />
          ))}
        </ul>
      )}

      {flights.length > MAX_ROWS && (
        <Link
          href="/logbook"
          className="mt-1 inline-flex items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] text-primary transition-colors hover:bg-[var(--on-glass-fill-soft)]"
        >
          All {flights.length} in logbook
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      )}
    </section>
  )
}

function FlightRow({
  flight,
  selected,
  onOpen,
  airportPref,
}: {
  flight: PeriodFlight
  selected: boolean
  onOpen: (id: string) => void
  airportPref: "icao" | "iata" | "both"
}) {
  const dep = getAirportDisplayCode(flight.departureIcao, flight.departureIata, airportPref)
  const arr = getAirportDisplayCode(flight.arrivalIcao, flight.arrivalIata, airportPref)

  return (
    <li className="border-b border-border/40 last:border-b-0">
      <button
        type="button"
        onClick={() => onOpen(flight.id)}
        aria-current={selected || undefined}
        className={cn(
          "flex min-h-9 w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left text-xs transition-colors hover:bg-[var(--on-glass-fill-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          selected && "bg-primary/10",
        )}
      >
        <span className="w-11 shrink-0 tabular-nums text-muted-foreground">
          {formatYMDShort(flight.date)}
        </span>
        <span className="w-12 shrink-0 truncate font-medium text-foreground">
          {flight.flightNumber || "—"}
        </span>
        {/* First column to go when the panel is narrow: at a 360px split it can
            only render as an empty truncation while its fixed siblings overflow
            the card. */}
        <span className="hidden min-w-0 flex-1 truncate tabular-nums text-foreground/80 @[15rem]:block">
          {dep || "—"}–{arr || "—"}
        </span>
        <span className="ml-auto shrink-0 tabular-nums text-foreground">
          {formatDecimalHours(flight.blockMinutes)}h
        </span>
        <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
    </li>
  )
}
