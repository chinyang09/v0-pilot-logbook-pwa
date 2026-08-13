"use client"

import * as React from "react"
import Link from "next/link"
import { ChevronRight, ArrowUpRight } from "lucide-react"

import { usePreferences } from "@/components/providers/preferences-provider"
import { formatDecimalHours, type PeriodFlight } from "@/lib/utils/dashboard-aggregate"
import { getAirportDisplayCode } from "@/lib/utils/airport-display"
import { formatClockDisplay } from "@/lib/utils/time"
import { formatYMDShort } from "@/lib/utils/date"
import { cn } from "@/lib/utils"

/**
 * The flights that make up the period's numbers — and what each one was.
 *
 * A row opens IN PLACE rather than navigating. The whole point of the list is
 * that a pilot is reading the period as a whole; sending them to a full flight
 * page to check one out-time loses the period they were looking at and costs a
 * back-navigation to get it back. The detail a card cannot fit is small enough
 * to unfold underneath it, and the row still offers the full page for anything
 * beyond that.
 *
 * The same interaction on every screen size. A phone and a 1400px desktop open
 * the same row the same way — what changes with width is how many columns the
 * detail lays out in, never where the detail appears.
 */

/**
 * Rows rendered before the list defers to the logbook.
 *
 * A year or an all-time period holds hundreds of flights, and mounting them all
 * costs real time on every dashboard visit for rows nobody scrolls to here.
 */
const MAX_ROWS = 40

export function PeriodFlights({
  flights,
  className,
}: {
  flights: PeriodFlight[]
  className?: string
}) {
  const { preferences } = usePreferences()
  const [openId, setOpenId] = React.useState<string | null>(null)

  const shown = flights.slice(0, MAX_ROWS)

  return (
    <section
      className={cn(
        "@container flex min-h-0 flex-col rounded-2xl border border-border/60 bg-card/70 p-3 shadow-sm",
        className,
      )}
      aria-label="Flights in period"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium text-muted-foreground">Flights</p>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {flights.length}
        </span>
      </div>

      {flights.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          No flights in this period
        </p>
      ) : (
        <ul className="mt-1">
          {shown.map((f) => (
            <FlightRow
              key={f.id}
              flight={f}
              open={openId === f.id}
              onToggle={() =>
                setOpenId((current) => (current === f.id ? null : f.id))
              }
              clockSeparator={preferences.display.clockSeparator}
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
  open,
  onToggle,
  clockSeparator,
  airportPref,
}: {
  flight: PeriodFlight
  open: boolean
  onToggle: () => void
  clockSeparator: "colon" | "none"
  airportPref: "icao" | "iata" | "both"
}) {
  const dep = getAirportDisplayCode(flight.departureIcao, flight.departureIata, airportPref)
  const arr = getAirportDisplayCode(flight.arrivalIcao, flight.arrivalIata, airportPref)

  return (
    <li className="border-b border-border/40 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left text-xs transition-colors hover:bg-[var(--on-glass-fill-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
            open && "rotate-90",
          )}
          aria-hidden="true"
        />
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
      </button>

      {open && (
        <FlightDetail flight={flight} clockSeparator={clockSeparator} dep={dep} arr={arr} />
      )}
    </li>
  )
}

function FlightDetail({
  flight,
  clockSeparator,
  dep,
  arr,
}: {
  flight: PeriodFlight
  clockSeparator: "colon" | "none"
  dep: string
  arr: string
}) {
  const clock = (t: string) => formatClockDisplay(t, clockSeparator, "—")

  return (
    <div className="pb-2 pl-6 pr-1">
      {/* OOOI first — it is what a logbook entry IS, and the reason the row was
          opened. Two columns on a phone, four as the panel widens. */}
      <dl className="grid grid-cols-4 gap-x-2 gap-y-1.5 @[22rem]:grid-cols-8">
        <Field label="Out" value={clock(flight.outTime)} />
        <Field label="Off" value={clock(flight.offTime)} />
        <Field label="On" value={clock(flight.onTime)} />
        <Field label="In" value={clock(flight.inTime)} />
        <Field label="Air" value={`${formatDecimalHours(flight.flightMinutes)}h`} />
        <Field label="Night" value={`${formatDecimalHours(flight.nightMinutes)}h`} />
        <Field label="T/O" value={String(flight.takeoffs)} />
        <Field label="Ldg" value={String(flight.landings)} />
      </dl>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {flight.aircraftReg && (
          <span className="text-foreground/80">
            {flight.aircraftReg}
            {flight.aircraftType && `, ${flight.aircraftType}`}
          </span>
        )}
        {flight.pilotRole && <span>{flight.pilotRole}</span>}
        <span>{flight.pilotFlying ? "PF" : "PM"}</span>
        {dep && arr && (
          <span className="tabular-nums @[15rem]:hidden">
            {dep}–{arr}
          </span>
        )}
        <Link
          href={`/flights/${flight.id}`}
          className="group ml-auto inline-flex items-center gap-1 text-primary transition-colors hover:underline"
        >
          Open
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground/70">
        {label}
      </dt>
      <dd className="truncate text-[11px] font-semibold tabular-nums text-foreground">
        {value}
      </dd>
    </div>
  )
}
